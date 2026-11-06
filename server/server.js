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
const https = require('node:https');

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
app.use(express.json({ limit: '256kb' }));

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
  text: { type: String, required: true, trim: true, maxlength: 1000 }
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

app.use('/api', authenticate);

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ _id: -1 }).limit(100).lean();
    const authorIds = [...new Set(posts.map((post) => post.authorId))];
    const authors = await User.find({ _id: { $in: authorIds } }).select('username displayUsername displayName avatarData').lean();
    const authorById = new Map(authors.map((author) => [author._id.toString(), author]));
    return res.json(posts.map((post) => {
      const author = authorById.get(post.authorId);
      return {
        id: post._id.toString(), author: author?.displayName || author?.displayUsername || post.authorName,
        authorUsername: author?.username || post.authorUsername || post.authorName.toLowerCase(),
        avatarData: author?.avatarData || '', text: post.text, createdAt: post.createdAt
      };
    }));
  } catch (error) {
    reportFailure('Load community posts failed', error);
    return res.status(500).json({ error: 'Could not load posts.' });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 1000) return res.status(400).json({ error: 'Write a post between 1 and 1000 characters.' });
    const author = await User.findById(req.userId).select('username displayUsername displayName avatarData');
    if (!author) return res.status(404).json({ error: 'Account not found.' });
    const post = await Post.create({ authorId: req.userId, authorName: author.displayName || author.displayUsername, authorUsername: author.username, text });
    return res.status(201).json({ id: post._id.toString(), author: post.authorName, authorUsername: author.username, avatarData: author.avatarData || '', text: post.text, createdAt: post.createdAt });
  } catch (error) {
    reportFailure('Create community post failed', error);
    return res.status(500).json({ error: 'Could not publish your post.' });
  }
});

app.get('/api/profiles/:username', async (req, res) => {
  try {
    const username = typeof req.params.username === 'string' ? req.params.username.trim().toLowerCase() : '';
    const user = await User.findOne({ username }).select('username displayUsername displayName bio avatarData createdAt').lean();
    if (!user) return res.status(404).json({ error: 'Profile not found.' });
    const [posts, postCount] = await Promise.all([
      Post.find({ authorId: user._id.toString() }).sort({ _id: -1 }).limit(100).lean(),
      Post.countDocuments({ authorId: user._id.toString() })
    ]);
    return res.json({
      username: user.username, displayUsername: user.displayUsername, displayName: user.displayName || user.displayUsername,
      bio: user.bio || '', avatarData: user.avatarData || '', createdAt: user.createdAt, postCount,
      posts: posts.map((post) => ({ id: post._id.toString(), text: post.text, createdAt: post.createdAt }))
    });
  } catch (error) {
    reportFailure('Load profile failed', error);
    return res.status(500).json({ error: 'Could not load this profile.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('+recoveryCodeHash');
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    reportFailure('Load account failed', error);
    return res.status(500).json({ error: 'Could not load account.' });
  }
});

app.put('/api/profile', async (req, res) => {
  try {
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim() : '';
    const avatarData = typeof req.body?.avatarData === 'string' ? req.body.avatarData : '';
    if (!displayName || displayName.length > 50) return res.status(400).json({ error: 'Display name must be between 1 and 50 characters.' });
    if (bio.length > 240) return res.status(400).json({ error: 'Bio must be 240 characters or less.' });
    if (avatarData && (avatarData.length > 180000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatarData))) {
      return res.status(400).json({ error: 'Choose a smaller JPG, PNG, or WebP profile photo.' });
    }
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    user.displayName = displayName;
    user.bio = bio;
    user.avatarData = avatarData;
    await user.save();
    return res.json({ user: publicUser(user) });
  } catch (error) {
    reportFailure('Update profile failed', error);
    return res.status(500).json({ error: 'Could not save your profile.' });
  }
});

app.post('/api/auth/recovery-code/generate', async (req, res) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to generate a recovery code.' });
    const user = await User.findById(req.userId).select('+password +recoveryCodeHash');
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const isHashed = /^\$2[aby]\$/.test(user.password);
    const passwordMatches = isHashed ? await bcrypt.compare(currentPassword, user.password) : currentPassword === user.password;
    if (!passwordMatches) return res.status(401).json({ error: 'Current password is incorrect.' });
    const recoveryCode = createRecoveryCode();
    user.recoveryCodeHash = recoveryCode.hash;
    if (!isHashed) user.password = await bcrypt.hash(currentPassword, 12);
    await user.save();
    return res.json({ message: 'Save this recovery code somewhere private. It is shown only once and replaces any previous code.', recoveryCode: recoveryCode.code });
  } catch (error) {
    reportFailure('Recovery code generation failed', error);
    return res.status(500).json({ error: 'Could not generate a recovery code.' });
  }
});

app.post('/api/auth/recovery-email/request', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to update your recovery email.' });
    const user = await User.findById(req.userId).select('+password');
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const isHashed = /^\$2[aby]\$/.test(user.password);
    const passwordMatches = isHashed ? await bcrypt.compare(currentPassword, user.password) : currentPassword === user.password;
    if (!passwordMatches) return res.status(401).json({ error: 'Current password is incorrect.' });
    const usedByOther = await User.exists({ _id: { $ne: user._id }, $or: [{ email }, { pendingRecoveryEmail: email }] });
    if (usedByOther) return res.status(409).json({ error: 'That email is already linked to another account.' });
    if (email === user.email && user.emailVerified) return res.json({ message: 'That recovery email is already verified.', user: publicUser(user) });
    const verificationToken = createOneTimeToken();
    user.pendingRecoveryEmail = email;
    user.emailVerificationTokenHash = verificationToken.hash;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (!isHashed) user.password = await bcrypt.hash(currentPassword, 12);
    await user.save();
    try {
      await sendVerificationEmail(email, user.displayUsername, verificationToken.token);
    } catch (emailError) {
      reportFailure('Recovery email verification message failed', emailError);
      const message = emailError.code === 'EMAIL_SERVICE_NOT_CONFIGURED'
        ? 'Email delivery is not configured on the API. Set RESEND_API_KEY and PASSWORD_RESET_FROM to a verified sender, then restart the API.'
        : 'Could not send the verification email. Check the email service settings and try again.';
      return res.status(503).json({ error: message });
    }
    return res.json({ message: 'Verification link sent. Check your inbox and follow it to enable password recovery.', user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'That email is already linked to another account.' });
    reportFailure('Recovery email request failed', error);
    return res.status(500).json({ error: 'Could not update the recovery email.' });
  }
});

app.get('/api/tasks/:userId', async (req, res) => {
  try {
    if (req.params.userId !== req.userId) return res.status(403).json({ error: 'Not allowed.' });
    const tasks = await Task.find({ userId: req.userId });
    return res.json(tasks.map((task) => ({ id: task._id.toString(), title: task.title, status: task.status, dueDate: task.dueDate, goalId: task.goalId?.toString(), plannedDate: task.plannedDate, points: task.points || 0, completedAt: task.completedAt })));
  } catch (error) {
    reportFailure('Load tasks failed', error);
    return res.status(500).json({ error: 'Could not load tasks.' });
  }
});

app.get('/api/study-goals', async (req, res) => {
  try {
    const goals = await StudyGoal.find({ userId: req.userId }).sort({ createdAt: 1 });
    return res.json(goals.map((goal) => ({ id: goal._id.toString(), title: goal.title, targetDate: goal.targetDate, subjects: goal.subjects, minutesPerDay: goal.minutesPerDay })));
  } catch (error) {
    reportFailure('Load study goals failed', error);
    return res.status(500).json({ error: 'Could not load study goals.' });
  }
});

app.post('/api/study-goals', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const targetDate = typeof req.body?.targetDate === 'string' ? req.body.targetDate : '';
    const minutesPerDay = Number(req.body?.minutesPerDay);
    const subjects = Array.isArray(req.body?.subjects)
      ? [...new Set(req.body.subjects.filter((subject) => typeof subject === 'string').map((subject) => subject.trim()).filter(Boolean).map((subject) => subject.slice(0, 60)))].slice(0, 12)
      : [];
    const today = new Date().toISOString().slice(0, 10);
    if (!title || title.length > 120) return res.status(400).json({ error: 'Enter a goal under 120 characters.' });
    if (targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < today)) return res.status(400).json({ error: 'Choose today or a future target date.' });
    if (!Number.isInteger(minutesPerDay) || minutesPerDay < 15 || minutesPerDay > 240) return res.status(400).json({ error: 'Daily study time must be 15 to 240 minutes.' });
    const goal = await StudyGoal.create({ userId: req.userId, title, targetDate, subjects, minutesPerDay });
    return res.status(201).json({ id: goal._id.toString(), title: goal.title, targetDate: goal.targetDate, subjects: goal.subjects, minutesPerDay: goal.minutesPerDay });
  } catch (error) {
    reportFailure('Create study goal failed', error);
    return res.status(500).json({ error: 'Could not create study goal.' });
  }
});

app.get('/api/study-plan/today', async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'A valid local date is required.' });
    const goals = await StudyGoal.find({
      userId: req.userId,
      $or: [{ targetDate: { $gte: date } }, { targetDate: '' }, { targetDate: { $exists: false } }]
    });
    for (const goal of goals) {
      const existing = await Task.exists({ userId: req.userId, goalId: goal._id, plannedDate: date });
      if (existing) continue;
      const dayNumber = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${goal.createdAt.toISOString().slice(0, 10)}T00:00:00Z`)) / 86400000);
      const subject = goal.subjects.length ? goal.subjects[Math.max(dayNumber, 0) % goal.subjects.length] : goal.title;
      const count = Math.max(1, Math.min(3, Math.ceil(goal.minutesPerDay / 30)));
      const minutes = Math.floor(goal.minutesPerDay / count);
      const steps = [
        `Review key ideas: ${subject}`,
        `Practice questions: ${subject}`,
        `Recall and summarize: ${subject}`
      ];
      await Task.insertMany(steps.slice(0, count).map((title) => ({
        userId: req.userId,
        goalId: goal._id,
        plannedDate: date,
        title: `${title} (${minutes} min)`,
        dueDate: date,
        points: 10,
        timerDurationSeconds: minutes * 60
      })), { ordered: false }).catch((error) => { if (error.code !== 11000 && !error.writeErrors?.every((entry) => entry.code === 11000)) throw error; });
    }
    const tasks = await Task.find({ userId: req.userId, plannedDate: date }).sort({ createdAt: 1 });
    for (const task of tasks) {
      if (!task.timerDurationSeconds) {
        const minutes = Number(task.title.match(/\((\d+) min\)$/)?.[1]) || 30;
        task.timerDurationSeconds = minutes * 60;
      }
      if (!task.timerState) task.timerState = 'ready';
      if (!Number.isFinite(task.timerAccumulatedSeconds)) task.timerAccumulatedSeconds = 0;
      if (task.timerState === 'running' && task.timerStartedAt) {
        const elapsed = task.timerAccumulatedSeconds + Math.floor((Date.now() - task.timerStartedAt.getTime()) / 1000);
        if (elapsed >= task.timerDurationSeconds) {
          task.timerAccumulatedSeconds = task.timerDurationSeconds;
          task.timerStartedAt = undefined;
          task.timerState = 'completed';
          task.status = 'Complete';
          task.completedAt = new Date();
        }
      }
      if (task.isModified()) await task.save();
    }
    const score = await Task.aggregate([
      { $match: { userId: req.userId, goalId: { $exists: true }, status: 'Complete' } },
      { $group: { _id: null, points: { $sum: '$points' }, completed: { $sum: 1 } } }
    ]);
    return res.json({
      tasks: tasks.map((task) => ({
        id: task._id.toString(), title: task.title, status: task.status, points: task.points || 10, goalId: task.goalId?.toString(),
        timerState: task.timerState || 'ready', timerDurationSeconds: task.timerDurationSeconds,
        timerAccumulatedSeconds: task.timerAccumulatedSeconds || 0, timerStartedAt: task.timerStartedAt
      })),
      score: score[0]?.points || 0,
      totalCompleted: score[0]?.completed || 0
    });
  } catch (error) {
    reportFailure('Load daily study plan failed', error);
    return res.status(500).json({ error: 'Could not prepare today’s study plan.' });
  }
});

app.put('/api/tasks/:id/timer', async (req, res) => {
  try {
    const action = req.body?.action;
    if (!['start', 'pause', 'resume', 'sync'].includes(action)) return res.status(400).json({ error: 'Choose start, pause, resume, or sync.' });
    const task = await Task.findOne({ _id: req.params.id, userId: req.userId, goalId: { $exists: true } });
    if (!task) return res.status(404).json({ error: 'Study session not found.' });
    if (!task.timerDurationSeconds) task.timerDurationSeconds = (Number(task.title.match(/\((\d+) min\)$/)?.[1]) || 30) * 60;
    if (!task.timerState) task.timerState = 'ready';
    if (task.status === 'Complete' || task.timerState === 'completed') {
      task.timerState = 'completed';
      return res.json({ id: task._id.toString(), status: 'Complete', points: task.points || 10, timerState: 'completed', timerDurationSeconds: task.timerDurationSeconds, timerAccumulatedSeconds: task.timerDurationSeconds });
    }
    const now = new Date();
    if (action === 'start' && task.timerState === 'ready') {
      task.timerState = 'running';
      task.timerStartedAt = now;
    } else if (action === 'resume' && task.timerState === 'paused') {
      task.timerState = 'running';
      task.timerStartedAt = now;
    } else if (action === 'pause' && task.timerState === 'running' && task.timerStartedAt) {
      task.timerAccumulatedSeconds += Math.max(0, Math.floor((now.getTime() - task.timerStartedAt.getTime()) / 1000));
      task.timerStartedAt = undefined;
      if (task.timerAccumulatedSeconds >= task.timerDurationSeconds) {
        task.timerAccumulatedSeconds = task.timerDurationSeconds;
        task.timerState = 'completed';
        task.status = 'Complete';
        task.completedAt = now;
      } else task.timerState = 'paused';
    } else if (action === 'sync' && task.timerState === 'running' && task.timerStartedAt) {
      const elapsed = task.timerAccumulatedSeconds + Math.max(0, Math.floor((now.getTime() - task.timerStartedAt.getTime()) / 1000));
      if (elapsed >= task.timerDurationSeconds) {
        task.timerAccumulatedSeconds = task.timerDurationSeconds;
        task.timerStartedAt = undefined;
        task.timerState = 'completed';
        task.status = 'Complete';
        task.completedAt = now;
      }
    } else if (action !== 'sync') {
      return res.status(409).json({ error: 'That timer action is not available right now.' });
    }
    await task.save();
    return res.json({
      id: task._id.toString(), status: task.status, points: task.points || 10, timerState: task.timerState,
      timerDurationSeconds: task.timerDurationSeconds, timerAccumulatedSeconds: task.timerAccumulatedSeconds || 0,
      timerStartedAt: task.timerStartedAt
    });
  } catch (error) {
    reportFailure('Study timer update failed', error);
    return res.status(500).json({ error: 'Could not update this study timer.' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title || title.length > 200) return res.status(400).json({ error: 'Task title is required and must be under 200 characters.' });
    const task = await Task.create({ userId: req.userId, title, dueDate: req.body.dueDate || 'Upcoming' });
    return res.status(201).json({ id: task._id.toString(), title: task.title, status: task.status, dueDate: task.dueDate });
  } catch (error) {
    reportFailure('Create task failed', error);
    return res.status(500).json({ error: 'Could not create task.' });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const status = req.body?.status;
    if (!['Ongoing', 'Complete', 'Dropped'].includes(status)) return res.status(400).json({ error: 'Invalid task status.' });
    const update = { status, completedAt: status === 'Complete' ? new Date() : null };
    const updated = await Task.findOneAndUpdate({ _id: req.params.id, userId: req.userId, goalId: { $exists: false } }, update, { returnDocument: 'after', runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Task not found.' });
    return res.json({ id: updated._id.toString(), title: updated.title, status: updated.status, dueDate: updated.dueDate, points: updated.points || 0, completedAt: updated.completedAt });
  } catch (error) {
    reportFailure('Update task failed', error);
    return res.status(500).json({ error: 'Could not update task.' });
  }
});

app.post('/api/friends/request-by-username', async (req, res) => {
  try {
    const receiverUsername = typeof req.body?.receiverUsername === 'string' ? req.body.receiverUsername.trim() : '';
    if (!receiverUsername) return res.status(400).json({ error: 'A username is required.' });
    const targetUser = await User.findOne({ username: receiverUsername.toLowerCase() });
    if (!targetUser) return res.status(404).json({ error: `User "${receiverUsername}" not found.` });
    if (req.userId === targetUser._id.toString()) return res.status(400).json({ error: 'You cannot send a friend request to yourself.' });
    const existing = await Friendship.findOne({
      $or: [
        { senderId: req.userId, receiverId: targetUser._id.toString() },
        { senderId: targetUser._id.toString(), receiverId: req.userId }
      ]
    });
    if (existing) return res.status(409).json({ error: 'Friend connection or pending request already exists.' });
    const senderUser = await User.findById(req.userId);
    const newRequest = await Friendship.create({
      senderId: req.userId,
      senderUsername: senderUser.displayUsername,
      receiverId: targetUser._id.toString(),
      receiverUsername: targetUser.displayUsername,
      status: 'pending'
    });
    return res.status(201).json(newRequest);
  } catch (error) {
    reportFailure('Create friend request failed', error);
    return res.status(500).json({ error: 'Could not send friend request.' });
  }
});

app.get('/api/friends/:userId', async (req, res) => {
  try {
    if (req.params.userId !== req.userId) return res.status(403).json({ error: 'Not allowed.' });
    const friendships = await Friendship.find({ $or: [{ senderId: req.userId }, { receiverId: req.userId }] });
    return res.json(friendships.map((friendship) => {
      const isSender = friendship.senderId === req.userId;
      return {
        id: friendship._id.toString(),
        senderId: friendship.senderId,
        receiverId: friendship.receiverId,
        status: friendship.status,
        senderUsername: friendship.senderUsername,
        receiverUsername: friendship.receiverUsername,
        friendId: isSender ? friendship.receiverId : friendship.senderId,
        friendUsername: isSender ? friendship.receiverUsername : friendship.senderUsername
      };
    }));
  } catch (error) {
    reportFailure('Load friends failed', error);
    return res.status(500).json({ error: 'Could not load friends.' });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  try {
    const requestId = req.body?.requestId;
    const request = await Friendship.findOneAndUpdate(
      { _id: requestId, receiverId: req.userId, status: 'pending' },
      { status: 'accepted' },
      { returnDocument: 'after', runValidators: true }
    );
    if (!request) return res.status(404).json({ error: 'Friend request not found.' });
    return res.json(request);
  } catch (error) {
    reportFailure('Accept friend request failed', error);
    return res.status(500).json({ error: 'Could not accept friend request.' });
  }
});

async function areFriends(userId, friendId) {
  if (!friendId || friendId === userId) return false;
  return Boolean(await Friendship.exists({
    status: 'accepted',
    $or: [
      { senderId: userId, receiverId: friendId },
      { senderId: friendId, receiverId: userId }
    ]
  }));
}

app.post('/api/chat/send', async (req, res) => {
  try {
    const receiverId = typeof req.body?.receiverId === 'string' ? req.body.receiverId : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 2000) return res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
    if (!await areFriends(req.userId, receiverId)) return res.status(403).json({ error: 'You can only message an accepted friend.' });
    const message = await Message.create({
      senderId: req.userId,
      receiverId,
      text,
      timestamp: new Date().toISOString()
    });
    return res.status(201).json(message);
  } catch (error) {
    reportFailure('Send message failed', error);
    return res.status(500).json({ error: 'Could not send message.' });
  }
});

app.get('/api/chat/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    if (user1 !== req.userId && user2 !== req.userId) return res.status(403).json({ error: 'Not allowed.' });
    const friendId = user1 === req.userId ? user2 : user1;
    if (!await areFriends(req.userId, friendId)) return res.status(403).json({ error: 'Chat is available to accepted friends only.' });
    const conversation = await Message.find({
      $or: [
        { senderId: req.userId, receiverId: friendId },
        { senderId: friendId, receiverId: req.userId }
      ]
    }).sort({ _id: 1 }).limit(500);
    return res.json(conversation);
  } catch (error) {
    reportFailure('Load chat failed', error);
    return res.status(500).json({ error: 'Could not load conversation.' });
  }
});

app.post('/api/team-tasks', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const memberId = typeof req.body?.memberId === 'string' ? req.body.memberId : '';
    if (!title || title.length > 200 || !memberId) return res.status(400).json({ error: 'Task title and friend are required.' });
    if (!await areFriends(req.userId, memberId)) return res.status(403).json({ error: 'Team tasks can only be shared with an accepted friend.' });
    const [creator, member] = await Promise.all([User.findById(req.userId), User.findById(memberId)]);
    const task = await TeamTask.create({
      title,
      members: [req.userId, memberId],
      memberNames: [creator.displayUsername, member.displayUsername],
      dueDate: req.body.dueDate || 'Upcoming'
    });
    return res.status(201).json({
      id: task._id.toString(), title: task.title, status: task.status, dueDate: task.dueDate, memberNames: task.memberNames
    });
  } catch (error) {
    reportFailure('Create team task failed', error);
    return res.status(500).json({ error: 'Could not create team task.' });
  }
});

app.get('/api/team-tasks/:userId', async (req, res) => {
  try {
    if (req.params.userId !== req.userId) return res.status(403).json({ error: 'Not allowed.' });
    const tasks = await TeamTask.find({ members: req.userId });
    return res.json(tasks.map((task) => ({
      id: task._id.toString(), title: task.title, status: task.status, dueDate: task.dueDate, memberNames: task.memberNames
    })));
  } catch (error) {
    reportFailure('Load team tasks failed', error);
    return res.status(500).json({ error: 'Could not load team tasks.' });
  }
});

app.put('/api/team-tasks/:id', async (req, res) => {
  try {
    const status = req.body?.status;
    if (!['Ongoing', 'Complete', 'Dropped'].includes(status)) return res.status(400).json({ error: 'Invalid task status.' });
    const task = await TeamTask.findOneAndUpdate(
      { _id: req.params.id, members: req.userId },
      { status },
      { returnDocument: 'after', runValidators: true }
    );
    if (!task) return res.status(404).json({ error: 'Team task not found.' });
    return res.json({ id: task._id.toString(), title: task.title, status: task.status, dueDate: task.dueDate, memberNames: task.memberNames });
  } catch (error) {
    reportFailure('Update team task failed', error);
    return res.status(500).json({ error: 'Could not update team task.' });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
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
