require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const registerApiRoutes = require('./api');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
const PORT = Number(process.env.PORT || 5002);
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://127.0.0.1:5173');
  allowedOrigins.add('http://localhost:5174');
  allowedOrigins.add('http://127.0.0.1:5174');
}
if (process.env.NODE_ENV === 'production') {
  if (!allowedOrigins.size) throw new Error('CLIENT_ORIGIN must be configured in production.');
  for (const origin of allowedOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CLIENT_ORIGIN must contain valid site origins.'); }
    if (parsed.origin !== origin || parsed.protocol !== 'https:') {
      throw new Error('Each production CLIENT_ORIGIN must be an HTTPS origin without a path or trailing slash.');
    }
  }
  const hasResendKey = Boolean(process.env.RESEND_API_KEY);
  const hasSender = Boolean(process.env.PASSWORD_RESET_FROM);
  if (hasResendKey !== hasSender) throw new Error('Configure both RESEND_API_KEY and PASSWORD_RESET_FROM, or leave both unset.');
}

if (!MONGO_URI) throw new Error('MONGO_URI must be configured.');
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 bytes.');
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    const error = new Error('Origin is not allowed by CORS.');
    error.status = 403;
    return callback(error);
  }
}));
app.use(express.json({ limit: '512kb' }));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayUsername: { type: String, required: true, trim: true },
  displayName: { type: String, trim: true, maxlength: 50, default: '' },
  bio: { type: String, trim: true, maxlength: 240, default: '' },
  avatarData: { type: String, default: '' },
  password: { type: String, required: true, select: false },
  email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
  pendingRecoveryEmail: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
  emailVerified: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0 },
  recoveryCodeHash: { type: String, select: false },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpires: { type: Date, select: false },
  resetPasswordTokenHash: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const taskSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  status: { type: String, enum: ['Ongoing', 'Complete', 'Dropped'], default: 'Ongoing' },
  dueDate: { type: String, default: 'Upcoming' }
}, { timestamps: true });
taskSchema.add({
  goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyGoal' },
  plannedDate: { type: String },
  points: { type: Number, default: 0 },
  completedAt: { type: Date },
  timerDurationSeconds: { type: Number, default: 0 },
  timerAccumulatedSeconds: { type: Number, default: 0 },
  timerStartedAt: { type: Date },
  timerState: { type: String, enum: ['ready', 'running', 'paused', 'completed'], default: 'ready' }
});
taskSchema.index({ userId: 1, goalId: 1, plannedDate: 1, title: 1 }, {
  unique: true,
  partialFilterExpression: { goalId: { $type: 'objectId' }, plannedDate: { $type: 'string' } }
});
const Task = mongoose.model('Task', taskSchema);

const studyGoalSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  targetDate: { type: String, default: '' },
  subjects: [{ type: String, trim: true, maxlength: 60 }],
  minutesPerDay: { type: Number, required: true, min: 15, max: 240 }
}, { timestamps: true });
const StudyGoal = mongoose.model('StudyGoal', studyGoalSchema);

const friendshipSchema = new mongoose.Schema({
  senderId: { type: String, required: true, index: true },
  senderUsername: { type: String, required: true },
  receiverId: { type: String, required: true, index: true },
  receiverUsername: { type: String, required: true },
  status: { type: String, enum: ['pending', 'accepted'], default: 'pending' }
}, { timestamps: true });
const Friendship = mongoose.model('Friendship', friendshipSchema);

const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true, index: true },
  receiverId: { type: String, required: true, index: true },
  text: { type: String, required: true, maxlength: 2000 },
  timestamp: { type: String, required: true }
}, { timestamps: true });
const Message = mongoose.model('Message', messageSchema);

const postSchema = new mongoose.Schema({
  authorId: { type: String, required: true, index: true },
  authorName: { type: String, required: true, maxlength: 50 },
  authorUsername: { type: String, maxlength: 32, default: '' },
  text: { type: String, trim: true, maxlength: 1000, default: '' },
  imageData: { type: String, default: '' },
  editedAt: { type: Date, default: null }
}, { timestamps: true });
const Post = mongoose.model('Post', postSchema);

const teamTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  members: [{ type: String, index: true }],
  memberNames: [{ type: String }],
  status: { type: String, enum: ['Ongoing', 'Complete', 'Dropped'], default: 'Ongoing' },
  dueDate: { type: String, default: 'Upcoming' }
}, { timestamps: true });
const TeamTask = mongoose.model('TeamTask', teamTaskSchema);

const authAttempts = new Map();
function limitAuthAttempts(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const record = authAttempts.get(key);
  if (authAttempts.size > 10000) {
    for (const [ip, attempt] of authAttempts) {
      if (now - attempt.startedAt > 15 * 60 * 1000) authAttempts.delete(ip);
    }
  }
  if (!record || now - record.startedAt > 15 * 60 * 1000) {
    authAttempts.set(key, { startedAt: now, count: 1 });
    return next();
  }
  record.count += 1;
  if (record.count > 20) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  return next();
}

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), ver: user.tokenVersion || 0 }, JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.displayUsername,
    displayName: user.displayName || user.displayUsername,
    bio: user.bio || '',
    avatarData: user.avatarData || '',
    createdAt: user.createdAt,
    recoveryEmail: user.email || user.pendingRecoveryEmail || '',
    recoveryEmailVerified: Boolean(user.emailVerified && user.email),
    hasRecoveryCode: Boolean(user.recoveryCodeHash),
    emailRecoveryAvailable: Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_RESET_FROM)
  };
}

async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Sign in required.' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
  try {
    const user = await User.findById(payload.sub).select('tokenVersion');
    if (!user || (payload.ver || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    }
    req.userId = user._id.toString();
    return next();
  } catch {
    return res.status(503).json({ error: 'Could not verify your session right now.' });
  }
}

function reportFailure(context, error) {
  console.error(`${context}:`, error);
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createOneTimeToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}

function createRecoveryCode() {
  const code = crypto.randomBytes(32).toString('hex').toUpperCase();
  return { code: code.match(/.{1,8}/g).join('-'), hash: crypto.createHash('sha256').update(code).digest('hex') };
}

function normalizeRecoveryCode(code) {
  return typeof code === 'string' ? code.replace(/[\s-]/g, '').toUpperCase() : '';
}

function appOrigin() {
  const origin = (process.env.CLIENT_ORIGIN || '').split(',').map((value) => value.trim()).find(Boolean);
  if (origin) return origin;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:5174';
  throw new Error('CLIENT_ORIGIN is not configured.');
}

function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM;
  if (!apiKey || !from) {
    const error = new Error('Resend email is not configured.');
    error.code = 'EMAIL_SERVICE_NOT_CONFIGURED';
    return Promise.reject(error);
  }
  const body = JSON.stringify({ from, to: [to], subject, text, html });
  return new Promise((resolve, reject) => {
    const request = https.request('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (response) => {
      response.resume();
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve();
        reject(new Error(`Resend returned status ${response.statusCode}.`));
      });
    });
    request.on('timeout', () => request.destroy(new Error('Resend request timed out.')));
    request.on('error', reject);
    request.end(body);
  });
}

function verificationLink(token) {
  const url = new URL('/', appOrigin());
  url.hash = new URLSearchParams({ verifyEmailToken: token }).toString();
  return url.toString();
}

function passwordResetLink(token) {
  const url = new URL('/', appOrigin());
  url.hash = new URLSearchParams({ resetToken: token }).toString();
  return url.toString();
}

async function sendVerificationEmail(email, username, token) {
  const link = verificationLink(token);
  await sendEmail({
    to: email,
    subject: 'Verify your Gyanaegis recovery email',
    text: `Hi ${username},\n\nConfirm this email address for account recovery. The link expires in 24 hours.\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${username},</p><p>Confirm this email address for account recovery. The link expires in 24 hours.</p><p><a href="${link}">Verify recovery email</a></p><p>If you did not request this, you can ignore this email.</p>`
  });
}

async function sendPasswordResetEmail(email, username, token) {
  const link = passwordResetLink(token);
  await sendEmail({
    to: email,
    subject: 'Reset your Gyanaegis password',
    text: `Hi ${username},\n\nUse this link to reset your password. It expires in 60 minutes.\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${username},</p><p>Use this link to reset your password. It expires in 60 minutes.</p><p><a href="${link}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`
  });
}

app.get('/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'database_unavailable' });
});

app.get('/api/auth/email-status', (req, res) => {
  return res.json({ enabled: Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_RESET_FROM) });
});

app.post('/api/auth/signup', limitAuthAttempts, async (req, res) => {
  try {
    const { username, password, confirmPassword } = req.body || {};
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    if (email && !validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address or leave it blank.' });
    const displayUsername = username.trim();
    const cleanName = displayUsername.toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(cleanName)) {
      return res.status(400).json({ error: 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.' });
    }
    if (Buffer.byteLength(password) < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 bytes.' });
    }
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const recoveryCode = createRecoveryCode();
    const userData = { username: cleanName, displayUsername, password: hashedPassword, recoveryCodeHash: recoveryCode.hash };
    let emailToken;
    if (email) {
      const existingEmail = await User.exists({ $or: [{ email }, { pendingRecoveryEmail: email }] });
      if (existingEmail) return res.status(409).json({ error: 'That email is already linked to an account.' });
      emailToken = createOneTimeToken();
      userData.pendingRecoveryEmail = email;
      userData.emailVerificationTokenHash = emailToken.hash;
      userData.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    const user = await User.create(userData);
    let verificationNotice = '';
    if (emailToken) {
      try {
        await sendVerificationEmail(email, displayUsername, emailToken.token);
        verificationNotice = ' Check your email to verify your recovery address.';
      } catch (emailError) {
        reportFailure('Recovery email verification message failed', emailError);
        verificationNotice = ' Your account was created, but email delivery is not configured. Set the Resend key and verified sender on the API, then open Recovery Email to try again.';
      }
    }
    return res.status(201).json({
      message: `Account registered.${verificationNotice}`,
      token: issueToken(user),
      user: publicUser(user),
      recoveryCode: recoveryCode.code
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: error.keyPattern?.username ? 'Username is already taken.' : 'That email is already linked to an account.' });
    reportFailure('Signup failed', error);
    return res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/signin', limitAuthAttempts, async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = await User.findOne({ username }).select('+password +recoveryCodeHash');
    if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

    const isHashed = /^\$2[aby]\$/.test(user.password);
    const validPassword = isHashed
      ? await bcrypt.compare(password, user.password)
      : password === user.password;
    if (!validPassword) return res.status(401).json({ error: 'Invalid username or password.' });
    if (!isHashed) {
      user.password = await bcrypt.hash(password, 12);
      await user.save();
    }

    return res.json({
      message: 'Sign in successful.',
      token: issueToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    reportFailure('Signin failed', error);
    return res.status(500).json({ error: 'Could not sign in.' });
  }
});

app.post('/api/auth/email/verify', limitAuthAttempts, async (req, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ emailVerificationTokenHash: tokenHash, emailVerificationExpires: { $gt: new Date() } })
      .select('+emailVerificationTokenHash +emailVerificationExpires');
    if (!user || !user.pendingRecoveryEmail) return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    user.email = user.pendingRecoveryEmail;
    user.emailVerified = true;
    user.pendingRecoveryEmail = undefined;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    return res.json({ message: 'Recovery email verified. Password recovery is now enabled.', recoveryEmail: user.email, recoveryEmailVerified: true });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'That email is already linked to another account.' });
    reportFailure('Recovery email verification failed', error);
    return res.status(500).json({ error: 'Could not verify the recovery email.' });
  }
});

app.post('/api/auth/password-reset/request', limitAuthAttempts, async (req, res) => {
  const genericResponse = { message: 'If a verified account uses that email, a password reset link will be sent.' };
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!validEmail(email)) return res.json(genericResponse);
    const user = await User.findOne({ email, emailVerified: true });
    if (!user) return res.json(genericResponse);
    const resetToken = createOneTimeToken();
    user.resetPasswordTokenHash = resetToken.hash;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    try {
      await sendPasswordResetEmail(user.email, user.displayUsername, resetToken.token);
    } catch (emailError) {
      user.resetPasswordTokenHash = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      reportFailure('Password reset email failed', emailError);
      const message = emailError.code === 'EMAIL_SERVICE_NOT_CONFIGURED'
        ? 'Email delivery is not configured on the API. Set RESEND_API_KEY and PASSWORD_RESET_FROM to a verified sender, then restart the API.'
        : 'Password reset email is not available right now. Please try again later.';
      return res.status(503).json({ error: message });
    }
    return res.json(genericResponse);
  } catch (error) {
    reportFailure('Password reset request failed', error);
    return res.status(500).json({ error: 'Could not process the password reset request.' });
  }
});

app.post('/api/auth/password-reset/complete', limitAuthAttempts, async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body || {};
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    if (typeof password !== 'string' || Buffer.byteLength(password) < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 bytes.' });
    }
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetPasswordTokenHash: tokenHash, resetPasswordExpires: { $gt: new Date() } })
      .select('+resetPasswordTokenHash +resetPasswordExpires +password');
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    user.password = await bcrypt.hash(password, 12);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    reportFailure('Password reset completion failed', error);
    return res.status(500).json({ error: 'Could not reset the password.' });
  }
});

app.post('/api/auth/password-reset/recovery-code', limitAuthAttempts, async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const code = normalizeRecoveryCode(req.body?.recoveryCode);
    const { password, confirmPassword } = req.body || {};
    if (!/^[a-z0-9_.-]{3,32}$/.test(username) || !/^[A-F0-9]{64}$/.test(code)) {
      return res.status(400).json({ error: 'The username or recovery code is invalid.' });
    }
    if (typeof password !== 'string' || Buffer.byteLength(password) < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 bytes.' });
    }
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const user = await User.findOne({ username, recoveryCodeHash: codeHash }).select('+recoveryCodeHash');
    if (!user) return res.status(400).json({ error: 'The username or recovery code is invalid.' });
    user.password = await bcrypt.hash(password, 12);
    user.recoveryCodeHash = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return res.json({ message: 'Password updated. The recovery code has been used. Sign in and generate a new code for next time.' });
  } catch (error) {
    reportFailure('Recovery code password reset failed', error);
    return res.status(500).json({ error: 'Could not reset the password.' });
  }
});

registerApiRoutes({ app, mongoose, bcrypt, User, Task, StudyGoal, Friendship, Message, Post, TeamTask, authenticate, publicUser, reportFailure, createRecoveryCode, normalizeRecoveryCode, createOneTimeToken, sendVerificationEmail, validEmail });
const clientBuildPath = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath, { index: false, maxAge: '1h' }));
  app.get('*path', (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/health') return next();
    return res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.status || error.statusCode || 500);
  if (status >= 500) reportFailure('Request failed', error);
  const message = status === 413 ? 'Request body is too large.' : status === 403 ? 'Request origin is not allowed.' : status >= 500 ? 'An unexpected server error occurred.' : 'Invalid request.';
  return res.status(status).json({ error: message });
});

async function startServer() {
  await mongoose.connect(MONGO_URI);
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gyanaegis API listening on port ${PORT}`);
  });
  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((error) => {
  console.error('Failed to start Gyanaegis API:', error.message);
  process.exit(1);
});
