function registerApiRoutes({ app, mongoose, bcrypt, User, Task, StudyGoal, Friendship, Message, Post, TeamTask, authenticate, publicUser, reportFailure, createRecoveryCode, normalizeRecoveryCode, createOneTimeToken, sendVerificationEmail, validEmail }) {
  app.use('/api', authenticate);

  function validPostImage(imageData) {
    return !imageData || (typeof imageData === 'string' && imageData.length <= 340000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData));
  }

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
          avatarData: author?.avatarData || '', text: post.text, imageData: post.imageData || '', editedAt: post.editedAt || null, createdAt: post.createdAt
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
      const imageData = typeof req.body?.imageData === 'string' ? req.body.imageData : '';
      if ((!text && !imageData) || text.length > 1000) return res.status(400).json({ error: 'Add text or a photo to your post (up to 1000 characters).' });
      if (!validPostImage(imageData)) return res.status(400).json({ error: 'Choose a smaller photo and try again.' });
      const author = await User.findById(req.userId).select('username displayUsername displayName avatarData');
      if (!author) return res.status(404).json({ error: 'Account not found.' });
      const post = await Post.create({ authorId: req.userId, authorName: author.displayName || author.displayUsername, authorUsername: author.username, text, imageData });
      return res.status(201).json({ id: post._id.toString(), author: post.authorName, authorUsername: author.username, avatarData: author.avatarData || '', text: post.text, imageData: post.imageData, editedAt: post.editedAt, createdAt: post.createdAt });
    } catch (error) {
      reportFailure('Create community post failed', error);
      return res.status(500).json({ error: 'Could not publish your post.' });
    }
  });

  app.patch('/api/posts/:id', async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const imageData = typeof req.body?.imageData === 'string' ? req.body.imageData : '';
      if ((!text && !imageData) || text.length > 1000) return res.status(400).json({ error: 'Add text or a photo to your post (up to 1000 characters).' });
      if (!validPostImage(imageData)) return res.status(400).json({ error: 'Choose a smaller photo and try again.' });
      const post = await Post.findOneAndUpdate({ _id: req.params.id, authorId: req.userId }, { text, imageData, editedAt: new Date() }, { returnDocument: 'after', runValidators: true });
      if (!post) return res.status(404).json({ error: 'Post not found or you cannot edit it.' });
      return res.json({ id: post._id.toString(), author: post.authorName, authorUsername: post.authorUsername, text: post.text, imageData: post.imageData || '', editedAt: post.editedAt, createdAt: post.createdAt });
    } catch (error) {
      reportFailure('Edit community post failed', error);
      return res.status(500).json({ error: 'Could not save your post.' });
    }
  });

  app.delete('/api/posts/:id', async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
      const post = await Post.findOneAndDelete({ _id: req.params.id, authorId: req.userId });
      if (!post) return res.status(404).json({ error: 'Post not found or you cannot delete it.' });
      return res.json({ id: post._id.toString() });
    } catch (error) {
      reportFailure('Delete community post failed', error);
      return res.status(500).json({ error: 'Could not delete your post.' });
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
        posts: posts.map((post) => ({ id: post._id.toString(), text: post.text, imageData: post.imageData || '', editedAt: post.editedAt || null, createdAt: post.createdAt }))
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
      if (typeof requestId !== 'string' || !mongoose.isValidObjectId(requestId)) return res.status(400).json({ error: 'This friend request is no longer valid. Refresh and try again.' });
      const request = await Friendship.findOne({ _id: requestId, receiverId: req.userId });
      if (!request) return res.status(404).json({ error: 'Friend request not found.' });
      if (request.status === 'accepted') return res.json({ id: request._id.toString(), status: 'accepted' });
      if (request.status !== 'pending') return res.status(409).json({ error: 'This friend request is no longer pending.' });
      request.status = 'accepted';
      await request.save();
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
}

module.exports = registerApiRoutes;
