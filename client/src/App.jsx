import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gy_cloud_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401 && localStorage.getItem('gy_cloud_token')) {
    localStorage.removeItem('gy_cloud_token');
    localStorage.removeItem('gy_cloud_user');
    window.location.reload();
  }
  return Promise.reject(error);
});

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    if (!localStorage.getItem('gy_cloud_token')) return null;
    try { return JSON.parse(localStorage.getItem('gy_cloud_user')) || null; }
    catch { return null; }
  });
  const [authMode, setAuthMode] = useState(() => new URLSearchParams(window.location.hash.slice(1) || window.location.search).has('resetToken') ? 'reset' : 'signin');
  const [resetTokenFromPage] = useState(() => new URLSearchParams(window.location.hash.slice(1) || window.location.search).get('resetToken') || '');
  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [resetEmailInput, setResetEmailInput] = useState('');
  const [resetUsernameInput, setResetUsernameInput] = useState('');
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [resetMethod, setResetMethod] = useState('code');
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [emailRecoveryEnabled, setEmailRecoveryEnabled] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryCodeDisplay, setRecoveryCodeDisplay] = useState('');
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('');
  const [recoveryPasswordInput, setRecoveryPasswordInput] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const isSignUp = authMode === 'signup';

  useEffect(() => {
    api.get('/auth/email-status').then((res) => setEmailRecoveryEnabled(Boolean(res.data.enabled))).catch(() => {});
  }, []);

  const [activeTab, setActiveTab] = useState('dashboard');

  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [studyGoals, setStudyGoals] = useState([]);
  const [dailyPlan, setDailyPlan] = useState({ tasks: [], score: 0, totalCompleted: 0 });
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalSubjects, setGoalSubjects] = useState('');
  const [goalMinutes, setGoalMinutes] = useState('60');
  const [goalError, setGoalError] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [composerType, setComposerType] = useState('study');
  const [taskFormError, setTaskFormError] = useState('');
  const [timerNow, setTimerNow] = useState(Date.now());
  const [timerError, setTimerError] = useState('');
  const timerSyncInFlight = useRef(new Set());

  const [friendships, setFriendships] = useState([]);
  const [friendUsernameInput, setFriendUsernameInput] = useState('');
  const [friendError, setFriendError] = useState('');
  const [friendSuccess, setFriendSuccess] = useState('');
  const [selectedFriend, setSelectedFriend] = useState(null);

  const [messages, setMessages] = useState([]);
  const [newMessageText, setNewMessageText] = useState('');
  const chatThreadRef = useRef(null);
  const [posts, setPosts] = useState([]);
  const [postText, setPostText] = useState('');
  const [postError, setPostError] = useState('');
  const [postsLoadError, setPostsLoadError] = useState('');
  const [postsLoading, setPostsLoading] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);

  const [teamTasks, setTeamTasks] = useState([]);
  const [newTeamTaskTitle, setNewTeamTaskTitle] = useState('');
  const [newTeamTaskDueDate, setNewTeamTaskDueDate] = useState('');
  const [selectedTeamMember, setSelectedTeamMember] = useState('');

  // Save current user session locally
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('gy_cloud_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('gy_cloud_user');
    }
  }, [currentUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
    const verificationToken = params.get('verifyEmailToken');
    const resetToken = params.get('resetToken');
    if (verificationToken) {
      api.post('/auth/email/verify', { token: verificationToken })
        .then(async (res) => {
          setAuthMessage(res.data.message);
          if (localStorage.getItem('gy_cloud_token')) {
            const account = await api.get('/auth/me');
            setCurrentUser(account.data.user);
          }
        })
        .catch((err) => setAuthError(err.response?.data?.error || 'Could not verify this email link.'))
        .finally(() => window.history.replaceState({}, document.title, window.location.pathname));
    } else if (resetToken) {
      setAuthMode('reset');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!currentUser?.id || currentUser.recoveryEmailVerified !== undefined) return;
    api.get('/auth/me').then((res) => setCurrentUser(res.data.user)).catch(() => {});
  }, [currentUser?.id]);

  // Fetch initial data when user is logged in
  useEffect(() => {
    if (currentUser) {
      fetchUserTasks();
      fetchStudyGoals();
      fetchDailyPlan();
      fetchFriendships();
      fetchTeamTasks();
      fetchPosts();
    }
  }, [currentUser]);

  // Live polling for chat and notifications
  useEffect(() => {
    let interval;
    if (currentUser) {
      interval = setInterval(() => {
        fetchFriendships();
        if (selectedFriend) {
          fetchMessages(selectedFriend.friendId);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [currentUser, selectedFriend]);

  useEffect(() => {
    if (!currentUser || activeTab !== 'posts') return undefined;
    const interval = setInterval(fetchPosts, 15000);
    return () => clearInterval(interval);
  }, [currentUser, activeTab]);

  const newestMessageId = messages.length ? (messages[messages.length - 1]._id || messages[messages.length - 1].id) : '';
  useEffect(() => {
    if (chatThreadRef.current) chatThreadRef.current.scrollTo({ top: chatThreadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, newestMessageId, selectedFriend?.friendId]);

  useEffect(() => {
    if (!dailyPlan.tasks.some((task) => task.timerState === 'running')) return undefined;
    const interval = setInterval(() => {
      const now = Date.now();
      setTimerNow(now);
      dailyPlan.tasks.forEach((task) => {
        if (task.timerState !== 'running' || getTaskSecondsLeft(task, now) > 0 || timerSyncInFlight.current.has(task.id)) return;
        timerSyncInFlight.current.add(task.id);
        api.put(`/tasks/${task.id}/timer`, { action: 'sync' })
          .then(() => fetchDailyPlan())
          .catch((err) => setTimerError(err.response?.data?.error || 'Could not finish the timer.'))
          .finally(() => timerSyncInFlight.current.delete(task.id));
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [dailyPlan.tasks]);

  // Auth Handlers
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');

    if (!usernameInput.trim() || !passwordInput) {
      setAuthError('Please fill in all fields.');
      return;
    }

    const endpoint = isSignUp ? '/auth/signup' : '/auth/signin';
    const payload = isSignUp
      ? { username: usernameInput, email: emailInput, password: passwordInput, confirmPassword: confirmPasswordInput }
      : { username: usernameInput, password: passwordInput };

    try {
      const res = await api.post(endpoint, payload);
      localStorage.setItem('gy_cloud_token', res.data.token);
      setCurrentUser(res.data.user);
      setAuthMessage(res.data.message || '');
      if (isSignUp) {
        setRecoveryCodeDisplay(res.data.recoveryCode || '');
        setRecoveryEmailInput(emailInput.trim());
        setRecoveryMessage(emailInput.trim() ? (res.data.message || 'Save your recovery code. Check your email to verify the address.') : 'Save this recovery code somewhere private. It is shown only once.');
        setRecoveryOpen(true);
      }
      setUsernameInput('');
      setEmailInput('');
      setPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Could not connect to cloud server.');
    }
  };

  const handlePasswordResetRequest = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthMessage('');
    try {
      const res = await api.post('/auth/password-reset/request', { email: resetEmailInput });
      setAuthMessage(res.data.message);
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Could not request a password reset.');
    }
  };

  const handleRecoveryCodeReset = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthMessage('');
    if (resetPasswordInput !== resetConfirmInput) return setAuthError('Passwords do not match.');
    try {
      const res = await api.post('/auth/password-reset/recovery-code', {
        username: resetUsernameInput,
        recoveryCode: recoveryCodeInput,
        password: resetPasswordInput,
        confirmPassword: resetConfirmInput
      });
      setAuthMessage(res.data.message);
      setRecoveryCodeInput('');
      setResetPasswordInput('');
      setResetConfirmInput('');
      localStorage.removeItem('gy_cloud_token');
      localStorage.removeItem('gy_cloud_user');
      setCurrentUser(null);
      setAuthMode('signin');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Could not reset the password.');
    }
  };

  const handlePasswordResetComplete = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthMessage('');
    if (resetPasswordInput !== resetConfirmInput) return setAuthError('Passwords do not match.');
    const token = resetTokenFromPage;
    try {
      const res = await api.post('/auth/password-reset/complete', { token, password: resetPasswordInput, confirmPassword: resetConfirmInput });
      setAuthMessage(res.data.message);
      setResetPasswordInput('');
      setResetConfirmInput('');
      localStorage.removeItem('gy_cloud_token');
      localStorage.removeItem('gy_cloud_user');
      setCurrentUser(null);
      setAuthMode('signin');
      setPasswordInput('');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Could not reset the password.');
    }
  };

  const handleRecoveryEmailSubmit = async (e) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryMessage('');
    try {
      const res = await api.post('/auth/recovery-email/request', { email: recoveryEmailInput, currentPassword: recoveryPasswordInput });
      if (res.data.user) setCurrentUser(res.data.user);
      setRecoveryMessage(res.data.message);
      setRecoveryPasswordInput('');
    } catch (err) {
      setRecoveryError(err.response?.data?.error || 'Could not update the recovery email.');
    }
  };

  const handleRecoveryCodeGenerate = async (e) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryMessage('');
    try {
      const res = await api.post('/auth/recovery-code/generate', { currentPassword: recoveryPasswordInput });
      setRecoveryCodeDisplay(res.data.recoveryCode);
      setRecoveryMessage(res.data.message);
      setRecoveryPasswordInput('');
      const account = await api.get('/auth/me');
      setCurrentUser(account.data.user);
    } catch (err) {
      setRecoveryError(err.response?.data?.error || 'Could not generate a recovery code.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('gy_cloud_token');
    setCurrentUser(null);
    setSelectedFriend(null);
    setTasks([]);
    setFriendships([]);
    setTeamTasks([]);
    setPosts([]);
    setPostText('');
    setPostError('');
    setActiveTab('dashboard');
  };

  // Personal Tasks API Handlers
  const fetchUserTasks = async () => {
    try {
      const res = await api.get(`/tasks/${currentUser.id}`);
      setTasks(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPosts = async () => {
    setPostsLoading(true);
    setPostsLoadError('');
    try {
      const res = await api.get('/posts');
      setPosts(res.data);
    } catch (err) {
      setPostsLoadError(err.response?.data?.error || 'Could not load community posts.');
    } finally { setPostsLoading(false); }
  };

  const publishPost = async (e) => {
    e.preventDefault();
    const text = postText.trim();
    if (!text || postSubmitting) return;
    setPostError('');
    setPostSubmitting(true);
    try {
      const res = await api.post('/posts', { text });
      setPosts((items) => [res.data, ...items].slice(0, 100));
      setPostText('');
    } catch (err) {
      setPostError(err.response?.data?.error || 'Could not publish your post.');
    } finally { setPostSubmitting(false); }
  };

  const localDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  const fetchStudyGoals = async () => {
    try {
      const res = await api.get('/study-goals');
      setStudyGoals(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchDailyPlan = async () => {
    try {
      const res = await api.get('/study-plan/today', { params: { date: localDate() } });
      setDailyPlan(res.data);
    } catch (err) { console.error(err); }
  };

  const getTaskSecondsLeft = (task, now = timerNow) => {
    const elapsed = (task.timerAccumulatedSeconds || 0) + (task.timerState === 'running' && task.timerStartedAt
      ? Math.max(0, Math.floor((now - new Date(task.timerStartedAt).getTime()) / 1000))
      : 0);
    return Math.max(0, (task.timerDurationSeconds || 0) - elapsed);
  };

  const formatTimer = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  const getTimerProgress = (task) => {
    if (task.timerState === 'completed' || task.status === 'Complete') return 100;
    if (task.timerState !== 'running' && task.timerState !== 'paused') return 0;
    const duration = task.timerDurationSeconds || 1;
    return Math.min(100, Math.round(((duration - getTaskSecondsLeft(task)) / duration) * 100));
  };

  const getDaysRemaining = (date) => {
    if (!date) return null;
    const [year, month, day] = date.split('-').map(Number);
    const today = new Date();
    const targetDay = Date.UTC(year, month - 1, day);
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.max(0, Math.round((targetDay - todayDay) / 86400000));
  };

  const updateStudyTimer = async (task, action) => {
    setTimerError('');
    try {
      const res = await api.put(`/tasks/${task.id}/timer`, { action });
      const updated = res.data;
      setDailyPlan((plan) => ({
        ...plan,
        tasks: plan.tasks.map((item) => item.id === task.id ? { ...item, ...updated } : item)
      }));
      if (updated.status === 'Complete' || updated.timerState === 'completed') await fetchDailyPlan();
    } catch (err) {
      setTimerError(err.response?.data?.error || 'Could not update the study timer.');
    }
  };

  const createStudyGoal = async (e) => {
    e.preventDefault();
    setGoalError('');
    setGoalSaving(true);
    try {
      await api.post('/study-goals', {
        title: goalTitle.trim(),
        targetDate: goalTargetDate,
        subjects: goalSubjects.split(',').map((subject) => subject.trim()).filter(Boolean),
        minutesPerDay: Number(goalMinutes)
      });
      setGoalTitle('');
      setGoalSubjects('');
      setGoalTargetDate('');
      await Promise.all([fetchStudyGoals(), fetchDailyPlan()]);
      setTaskComposerOpen(false);
    } catch (err) {
      setGoalError(err.response?.data?.error || 'Could not create your study goal.');
    } finally { setGoalSaving(false); }
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !currentUser) return;
    setTaskFormError('');

    try {
      const res = await api.post('/tasks', {
        title: newTaskTitle.trim(),
        userId: currentUser.id,
        dueDate: newTaskDueDate || 'Upcoming'
      });
      setTasks([...tasks, res.data]);
      setNewTaskTitle('');
      setNewTaskDueDate('');
      setTaskComposerOpen(false);
    } catch (err) {
      setTaskFormError(err.response?.data?.error || 'Could not add this task.');
    }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    try {
      await api.put(`/tasks/${taskId}`, { status: newStatus });
      setTasks(tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
      await fetchDailyPlan();
    } catch (err) {
      console.error(err);
    }
  };

  // Friends & Social Cloud Handlers
  const fetchFriendships = async () => {
    try {
      const res = await api.get(`/friends/${currentUser.id}`);
      setFriendships(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const sendFriendRequest = async (e) => {
    e.preventDefault();
    setFriendError('');
    setFriendSuccess('');

    if (!friendUsernameInput.trim()) return;

    try {
      await api.post('/friends/request-by-username', {
        senderId: currentUser.id,
        receiverUsername: friendUsernameInput.trim()
      });
      setFriendSuccess(`Friend request sent to ${friendUsernameInput.trim()}!`);
      setFriendUsernameInput('');
      fetchFriendships();
    } catch (err) {
      setFriendError(err.response?.data?.error || 'Could not send friend request.');
    }
  };

  const acceptFriendRequest = async (requestId) => {
    try {
      await api.post('/friends/accept', { requestId });
      fetchFriendships();
    } catch (err) {
      console.error(err);
    }
  };

  // Chat API Handlers
  const fetchMessages = async (friendId) => {
    try {
      const res = await api.get(`/chat/${currentUser.id}/${friendId}`);
      setMessages(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessageText.trim() || !selectedFriend) return;

    try {
      await api.post('/chat/send', {
        senderId: currentUser.id,
        receiverId: selectedFriend.friendId,
        text: newMessageText.trim()
      });
      setNewMessageText('');
      fetchMessages(selectedFriend.friendId);
    } catch (err) {
      console.error(err);
    }
  };

  // Team Tasks Cloud Handlers
  const fetchTeamTasks = async () => {
    try {
      const res = await api.get(`/team-tasks/${currentUser.id}`);
      setTeamTasks(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const addTeamTask = async (e) => {
    e.preventDefault();
    if (!newTeamTaskTitle.trim() || !selectedTeamMember) {
      setTaskFormError('Choose a friend to share this task with.');
      return;
    }
    setTaskFormError('');

    try {
      const res = await api.post('/team-tasks', {
        title: newTeamTaskTitle.trim(),
        creatorId: currentUser.id,
        memberId: selectedTeamMember,
        dueDate: newTeamTaskDueDate || 'Upcoming'
      });
      setTeamTasks([...teamTasks, res.data]);
      setNewTeamTaskTitle('');
      setNewTeamTaskDueDate('');
      setSelectedTeamMember('');
      setTaskComposerOpen(false);
    } catch (err) {
      setTaskFormError(err.response?.data?.error || 'Could not create the shared task.');
    }
  };

  const updateTeamTaskStatus = async (taskId, newStatus) => {
    try {
      await api.put(`/team-tasks/${taskId}`, { status: newStatus });
      setTeamTasks(teamTasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    } catch (err) {
      console.error(err);
    }
  };

  if (!currentUser) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginCard}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <div style={styles.logoIcon}>🎓</div>
          </div>
          <h2 style={{ color: '#38bdf8', marginBottom: '0.5rem' }}>Gyanaegis Cloud Hub</h2>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
            {authMode === 'signup' ? 'Create a cloud student account' : authMode === 'forgot' ? 'Request a secure password reset link' : authMode === 'reset' ? 'Choose a new password' : 'Sign in to your portal'}
          </p>

          {authError && <div style={styles.errorAlert}>{authError}</div>}
          {authMessage && <div style={styles.successAlert}>{authMessage}</div>}

          {authMode === 'forgot' ? (
            <>
              {emailRecoveryEnabled && (
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                  <button type="button" onClick={() => { setResetMethod('code'); setAuthError(''); setAuthMessage(''); }} style={resetMethod === 'code' ? styles.button : styles.accountBtn}>Use Recovery Code</button>
                  <button type="button" onClick={() => { setResetMethod('email'); setAuthError(''); setAuthMessage(''); }} style={resetMethod === 'email' ? styles.button : styles.accountBtn}>Use Email</button>
                </div>
              )}
              {resetMethod === 'email' && emailRecoveryEnabled ? (
                <form onSubmit={handlePasswordResetRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <input type="email" placeholder="Verified recovery email..." value={resetEmailInput} onChange={(e) => setResetEmailInput(e.target.value)} style={styles.input} required />
                  <button type="submit" style={styles.button}>Send Reset Link</button>
                </form>
              ) : (
                <form onSubmit={handleRecoveryCodeReset} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <input type="text" placeholder="Username..." value={resetUsernameInput} onChange={(e) => setResetUsernameInput(e.target.value)} style={styles.input} required />
                  <input type="text" placeholder="Saved recovery code..." value={recoveryCodeInput} onChange={(e) => setRecoveryCodeInput(e.target.value)} style={styles.input} autoCapitalize="characters" required />
                  <input type="password" placeholder="New password (8–72 bytes)..." value={resetPasswordInput} onChange={(e) => setResetPasswordInput(e.target.value)} style={styles.input} minLength={8} required />
                  <input type="password" placeholder="Confirm new password..." value={resetConfirmInput} onChange={(e) => setResetConfirmInput(e.target.value)} style={styles.input} minLength={8} required />
                  <button type="submit" style={styles.button}>Reset Password</button>
                </form>
              )}
              {!emailRecoveryEnabled && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Use the one-time recovery code saved when the account was created or in Recovery Options.</p>}
            </>
          ) : authMode === 'reset' ? (
            <form onSubmit={handlePasswordResetComplete} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input type="password" placeholder="New password (8–72 bytes)..." value={resetPasswordInput} onChange={(e) => setResetPasswordInput(e.target.value)} style={styles.input} minLength={8} required />
              <input type="password" placeholder="Confirm new password..." value={resetConfirmInput} onChange={(e) => setResetConfirmInput(e.target.value)} style={styles.input} minLength={8} required />
              <button type="submit" style={styles.button}>Reset Password</button>
            </form>
          ) : (
            <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input type="text" placeholder="Username..." value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} style={styles.input} required />
              {isSignUp && emailRecoveryEnabled && <input type="email" placeholder="Recovery email (optional)..." value={emailInput} onChange={(e) => setEmailInput(e.target.value)} style={styles.input} />}
              <input type="password" placeholder="Password..." value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} style={styles.input} required />
              {isSignUp && (
              <input
                type="password"
                placeholder="Confirm Password..."
                value={confirmPasswordInput}
                onChange={(e) => setConfirmPasswordInput(e.target.value)}
                style={styles.input}
                required
              />
            )}
              <button type="submit" style={styles.button}>{isSignUp ? 'Create Account' : 'Sign In'}</button>
            </form>
          )}

          <div style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: '#94a3b8' }}>
            {authMode === 'signup' ? (
              <span>Already have an account? <button type="button" onClick={() => { setAuthMode('signin'); setAuthError(''); setAuthMessage(''); }} style={styles.switchBtn}>Sign In</button></span>
            ) : authMode === 'signin' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <span><button type="button" onClick={() => { setAuthMode('forgot'); setAuthError(''); setAuthMessage(''); }} style={styles.switchBtn}>Forgot password?</button></span>
                <span>Don't have an account? <button type="button" onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthMessage(''); }} style={styles.switchBtn}>Sign Up</button></span>
              </div>
            ) : (
              <span><button type="button" onClick={() => { setAuthMode('signin'); setAuthError(''); setAuthMessage(''); }} style={styles.switchBtn}>Back to Sign In</button></span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const acceptedFriends = friendships.filter(f => f.status === 'accepted');
  const pendingRequests = friendships.filter(f => f.status === 'pending' && f.receiverId === currentUser.id);
  const personalTasks = tasks.filter((task) => !task.goalId);
  const completedStudyTasks = dailyPlan.tasks.filter((task) => task.status === 'Complete').length;
  const studyProgress = dailyPlan.tasks.length ? Math.round((completedStudyTasks / dailyPlan.tasks.length) * 100) : 0;
  const completedTeamTasks = teamTasks.filter((task) => task.status === 'Complete').length;
  const taskCount = dailyPlan.tasks.length + personalTasks.length + teamTasks.length;
  const completedTaskCount = completedStudyTasks + personalTasks.filter((task) => task.status === 'Complete').length + completedTeamTasks;

  return (
    <div className="app-shell" style={styles.container}>
      <header className="app-topbar" style={styles.header}>
        <div className="app-brand" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="brand-mark">🎓</div>
          <h1 style={styles.logoText}>Gyanaegis Academic Hub</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span className="user-badge" style={styles.userBadge}>👤 {currentUser.username}</span>
          <button onClick={async () => {
            setRecoveryError('');
            setRecoveryMessage('');
            setRecoveryEmailInput(currentUser.recoveryEmail || '');
            setRecoveryCodeDisplay('');
            setRecoveryOpen(true);
            try {
              const res = await api.get('/auth/me');
              setCurrentUser(res.data.user);
              setRecoveryEmailInput(res.data.user.recoveryEmail || '');
            } catch {}
          }} style={styles.accountBtn}>Recovery Options{currentUser.hasRecoveryCode ? ' ✓' : ''}</button>
          <button onClick={handleLogout} style={styles.logoutBtn}>Sign Out</button>
        </div>
      </header>

      {recoveryOpen && (
        <div style={styles.modalBackdrop}>
          <section role="dialog" aria-modal="true" aria-labelledby="recoveryTitle" style={styles.modalCard}>
            <h2 id="recoveryTitle" style={{ color: '#38bdf8', marginTop: 0 }}>Recovery Options</h2>
            {recoveryError && <div style={styles.errorAlert}>{recoveryError}</div>}
            {recoveryMessage && <div style={styles.successAlert}>{recoveryMessage}</div>}
            {recoveryCodeDisplay ? (
              <div style={{ marginBottom: '1.25rem' }}>
                <p style={{ color: '#fecaca', fontWeight: 'bold' }}>Save this one-time code somewhere private. It will not be shown again.</p>
                <input aria-label="One-time recovery code" readOnly value={recoveryCodeDisplay} onFocus={(e) => e.target.select()} style={{ ...styles.input, width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', letterSpacing: '0.04em' }} />
                <button type="button" onClick={async () => {
                  try { await navigator.clipboard.writeText(recoveryCodeDisplay); setRecoveryMessage('Recovery code copied. Save it somewhere private.'); }
                  catch { setRecoveryError('Clipboard access is unavailable. Select and copy the code above.'); }
                }} style={{ ...styles.accountBtn, marginTop: '0.75rem' }}>Copy Recovery Code</button>
              </div>
            ) : (
              <>
                <p style={{ color: '#cbd5e1' }}>Generate a one-time recovery code now. It works without email and replaces any previous code.</p>
                <form onSubmit={handleRecoveryCodeGenerate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <input type="password" placeholder="Current password..." value={recoveryPasswordInput} onChange={(e) => setRecoveryPasswordInput(e.target.value)} style={styles.input} required />
                  <button type="submit" style={styles.button}>Generate Recovery Code</button>
                </form>
              </>
            )}
            {emailRecoveryEnabled ? (
              <details style={{ marginTop: '1.25rem', color: '#cbd5e1' }}>
                <summary style={{ cursor: 'pointer' }}>Optional: set up email recovery</summary>
                <p>{currentUser.recoveryEmailVerified ? `Verified email: ${currentUser.recoveryEmail}` : currentUser.recoveryEmail ? `${currentUser.recoveryEmail} is waiting for verification.` : 'Email must be verified before it can reset your password.'}</p>
                {recoveryError && <div style={styles.errorAlert}>{recoveryError}</div>}
                <form onSubmit={handleRecoveryEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <input type="email" placeholder="Recovery email..." value={recoveryEmailInput} onChange={(e) => setRecoveryEmailInput(e.target.value)} style={styles.input} required />
                  <input type="password" placeholder="Current password..." value={recoveryPasswordInput} onChange={(e) => setRecoveryPasswordInput(e.target.value)} style={styles.input} required />
                  <button type="submit" style={styles.button}>Send Verification Link</button>
                </form>
              </details>
            ) : (
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '1rem' }}>Email recovery can be enabled later. Your recovery code works now without a domain or email service.</p>
            )}
            <button type="button" onClick={() => { setRecoveryOpen(false); setRecoveryCodeDisplay(''); }} style={{ ...styles.switchBtn, marginTop: '1rem' }}>Close</button>
          </section>
        </div>
      )}

      {taskComposerOpen && <div className="modalBackdrop task-composer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTaskComposerOpen(false); }}>
        <section className="task-composer" role="dialog" aria-modal="true" aria-labelledby="taskComposerTitle">
          <div className="task-composer-heading"><div><span className="section-kicker">ADD SOMETHING TO YOUR LIST</span><h2 id="taskComposerTitle">Create a task</h2></div><button className="composer-close" type="button" aria-label="Close" onClick={() => setTaskComposerOpen(false)}>×</button></div>
          <div className="composer-types" role="group" aria-label="Task type">
            {[['study', '🎯', 'Study goal'], ['personal', '📝', 'Personal'], ['shared', '🤝', 'Shared']].map(([type, icon, label]) => <button className={`composer-type ${composerType === type ? 'type-selected' : ''}`} type="button" aria-pressed={composerType === type} key={type} onClick={() => { setComposerType(type); setTaskFormError(''); setGoalError(''); }}><span>{icon}</span>{label}</button>)}
          </div>
          {composerType === 'study' ? <form className="composer-form" onSubmit={createStudyGoal}>
            <label>What are you preparing for?<input className="colorful-input" type="text" placeholder="e.g. Biology exam" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} maxLength={120} required /></label>
            <div className="composer-form-row"><label>Target date <small>optional</small><input className="colorful-input" type="date" value={goalTargetDate} min={localDate()} onChange={(e) => setGoalTargetDate(e.target.value)} /></label><label>Study time per day<select className="colorful-input" value={goalMinutes} onChange={(e) => setGoalMinutes(e.target.value)}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></label></div>
            <label>Subjects or topics <small>optional · separate with commas</small><input className="colorful-input" type="text" placeholder="Biology, Chemistry…" value={goalSubjects} onChange={(e) => setGoalSubjects(e.target.value)} /></label>
            {goalError && <p className="form-error" role="alert">{goalError}</p>}
            <div className="composer-actions"><button className="composer-cancel" type="button" onClick={() => setTaskComposerOpen(false)}>Cancel</button><button className="colorful-button" type="submit" style={styles.button} disabled={goalSaving}>{goalSaving ? 'Saving…' : 'Create study goal'}</button></div>
          </form> : composerType === 'personal' ? <form className="composer-form" onSubmit={addTask}>
            <label>Task name<input className="colorful-input" type="text" placeholder="What do you need to do?" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} maxLength={200} required /></label>
            <label>Due date <small>optional</small><input className="colorful-input" type="date" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} /></label>
            {taskFormError && <p className="form-error" role="alert">{taskFormError}</p>}
            <div className="composer-actions"><button className="composer-cancel" type="button" onClick={() => setTaskComposerOpen(false)}>Cancel</button><button className="colorful-button" type="submit" style={styles.button}>Add personal task</button></div>
          </form> : <form className="composer-form" onSubmit={addTeamTask}>
            <label>Shared task name<input className="colorful-input" type="text" placeholder="What will you work on together?" value={newTeamTaskTitle} onChange={(e) => setNewTeamTaskTitle(e.target.value)} maxLength={200} required /></label>
            <label>Study buddy<select className="colorful-input" value={selectedTeamMember} onChange={(e) => setSelectedTeamMember(e.target.value)} required><option value="">Choose a friend…</option>{acceptedFriends.map((friend) => <option key={friend.friendId} value={friend.friendId}>{friend.friendUsername}</option>)}</select></label>
            <label>Due date <small>optional</small><input className="colorful-input" type="date" value={newTeamTaskDueDate} onChange={(e) => setNewTeamTaskDueDate(e.target.value)} /></label>
            {!acceptedFriends.length && <p className="composer-hint">Add a friend in Friends & Chat before creating a shared task.</p>}
            {taskFormError && <p className="form-error" role="alert">{taskFormError}</p>}
            <div className="composer-actions"><button className="composer-cancel" type="button" onClick={() => setTaskComposerOpen(false)}>Cancel</button><button className="colorful-button" type="submit" style={styles.button} disabled={!acceptedFriends.length}>Share task</button></div>
          </form>}
        </section>
      </div>}

      <nav className="app-nav" style={styles.navBar}>
        <button className={`nav-pill ${activeTab === 'dashboard' ? 'is-active' : ''}`} style={{ ...styles.navTab, ...(activeTab === 'dashboard' ? styles.activeTab : {}) }} onClick={() => setActiveTab('dashboard')}>📋 <span>Tasks</span></button>
        <button className={`nav-pill ${activeTab === 'posts' ? 'is-active' : ''}`} style={{ ...styles.navTab, ...(activeTab === 'posts' ? styles.activeTab : {}) }} onClick={() => setActiveTab('posts')}>✍️ <span>Posts</span></button>
        <button className={`nav-pill ${activeTab === 'friends' ? 'is-active' : ''}`} style={{ ...styles.navTab, ...(activeTab === 'friends' ? styles.activeTab : {}) }} onClick={() => setActiveTab('friends')}>💬 <span>Friends & Chat {pendingRequests.length > 0 && `(${pendingRequests.length})`}</span></button>
      </nav>

      <main className="main-content" style={styles.main}>
        {activeTab === 'dashboard' && (
          <>
            <div className="tasks-page-heading">
              <div><span className="section-kicker">YOUR PERSONAL WORKSPACE</span><h2>Tasks</h2><p>Study, personal, and shared tasks in one place.</p></div>
              <button className="colorful-button add-task-top" type="button" style={styles.button} onClick={() => { setTaskComposerOpen(true); setTaskFormError(''); setGoalError(''); }}>＋ Add task</button>
            </div>

            <div className="dashboard-stats" style={styles.statsGrid}>
              <div className="metric-card metric-points" style={styles.statCard}>
                <div className="metric-icon">⭐</div><div><p style={styles.statLabel}>Study points</p><p style={styles.statValue}>{dailyPlan.score}</p></div>
              </div>
              <div className="metric-card metric-sessions" style={styles.statCard}>
                <div className="metric-icon">📋</div><div><p style={styles.statLabel}>All tasks</p><p style={styles.statValue}>{taskCount}</p></div>
              </div>
              <div className="metric-card metric-progress" style={styles.statCard}>
                <div className="metric-icon">✅</div><div><p style={styles.statLabel}>Completed tasks</p><p style={styles.statValue}>{completedTaskCount}</p></div>
              </div>
            </div>

            <div className="study-panel goals-panel" style={styles.taskSection}>
              <div className="section-heading"><div><span className="section-kicker">STUDY GOALS</span><h3>Your focus</h3></div></div>
              {studyGoals.length > 0 ? <div className="goal-chip-list" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', margin: '1rem 0' }}>
                {studyGoals.map((goal) => <span className="goal-chip" key={goal.id} style={{ ...styles.statusBadge, backgroundColor: '#1d4ed8', padding: '0.45rem 0.8rem' }}>
                  🎯 {goal.title} · {goal.targetDate ? `📅 ${getDaysRemaining(goal.targetDate) === 0 ? 'Due today' : `${getDaysRemaining(goal.targetDate)} days left`} · ${new Date(`${goal.targetDate}T00:00:00`).toLocaleDateString()}` : '📅 No deadline set'}
                </span>)}
              </div> : <p className="focus-empty">No study goal yet. Choose <strong>Add task → Study goal</strong> to create one.</p>}
            </div>

            <div className="study-panel plan-panel" style={{ ...styles.taskSection, marginTop: '1.5rem' }}>
              <div className="section-heading plan-heading"><div><span className="section-kicker">DAILY STUDY TASKS</span><h3>Today’s study plan</h3><p>Short, focused sessions are a win. Pause anytime; points arrive when the timer ends.</p></div><span className="plan-date-chip">☀️ Today</span></div>
              <div className="daily-progress-wrap"><div className="daily-progress-label"><span>Today’s progress</span><strong>{studyProgress}%</strong></div><div className="daily-progress-track"><div className="daily-progress-fill" style={{ width: `${studyProgress}%` }} /></div></div>
              {timerError && <p role="alert" style={{ color: '#fca5a5' }}>{timerError}</p>}
              <div className="study-session-list" style={styles.taskList}>
                {dailyPlan.tasks.length === 0 ? (
                  <p style={{ color: '#94a3b8', textAlign: 'center', margin: '1.5rem 0' }}>{studyGoals.length ? 'Your next daily plan will be ready on your study date.' : 'Add a study goal to get daily tasks here.'}</p>
                ) : (
                  dailyPlan.tasks.map((task) => (
                    <div className={`study-session-card ${task.status === 'Complete' ? 'session-complete' : task.timerState === 'running' ? 'session-running' : ''}`} key={task.id} style={{ ...styles.taskItem, flexWrap: 'wrap', gap: '0.75rem', background: task.status === 'Complete' ? 'rgba(16,185,129,0.08)' : 'transparent', borderRadius: '8px' }}>
                      <div className="session-copy" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flex: '1 1 260px' }}>
                        <span className="session-emoji" style={{ fontSize: '1.35rem' }}>{task.status === 'Complete' ? '✅' : '📘'}</span>
                        <div><strong className="session-title">{task.title}</strong><p style={styles.taskSubtext}>{task.status === 'Complete' ? 'Nice work — you showed up for your goal!' : 'A focused session is enough. Take it at your pace.'}</p></div>
                      </div>
                      {task.status === 'Complete' ? <span className="earned-points" style={{ ...styles.statusBadge, backgroundColor: '#059669' }}>+{task.points} points earned 🎉</span> : (
                        <div className="session-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <div className="timer-stack">
                            <div className={`timer-face ${task.timerState === 'paused' ? 'timer-is-paused' : ''}`} style={{ '--timer-progress': `${getTimerProgress(task)}%` }}>
                              <div className="timer-face-inner">
                                <span className="timer-label">{task.timerState === 'running' ? 'LEFT' : task.timerState === 'paused' ? 'PAUSED' : 'READY'}</span>
                                <strong className="timer-digits" aria-live="off">{formatTimer(getTaskSecondsLeft(task))}</strong>
                              </div>
                            </div>
                          </div>
                          {task.timerState === 'running' ? (
                            <button className="timer-action timer-pause" type="button" onClick={() => updateStudyTimer(task, 'pause')} style={styles.actionSelect}>Ⅱ Pause</button>
                          ) : task.timerState === 'paused' ? (
                            <button className="timer-action timer-resume" type="button" onClick={() => updateStudyTimer(task, 'resume')} style={styles.button}>▶ Resume</button>
                          ) : (
                            <button className="timer-action timer-start" type="button" onClick={() => updateStudyTimer(task, 'start')} style={styles.button}>▶ Start session</button>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="study-panel personal-panel" style={{ ...styles.taskSection, marginTop: '1.5rem' }}>
              <div className="section-heading"><div><span className="section-kicker">YOUR OWN TASKS</span><h3>Personal tasks</h3></div><span className="section-count">{personalTasks.length}</span></div>
              <div style={styles.taskList}>
                {personalTasks.length === 0 ? <p className="focus-empty">No personal tasks yet. Use <strong>Add task</strong> to make one.</p> : personalTasks.map((task) => (
                  <div key={task.id} style={styles.taskItem}>
                    <div><strong>{task.title}</strong><p style={styles.taskSubtext}>Due: {task.dueDate}</p></div>
                    <select aria-label={`Status for ${task.title}`} style={styles.actionSelect} value={task.status} onChange={(e) => updateTaskStatus(task.id, e.target.value)}>
                      <option value="Ongoing">Ongoing</option><option value="Complete">Complete</option><option value="Dropped">Dropped</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="study-panel team-list-panel" style={{ marginTop: '1rem' }}>
              <div className="section-heading"><div><span className="section-kicker">WITH YOUR FRIENDS</span><h3>Shared tasks</h3></div><span className="section-count">{teamTasks.length}</span></div>
              {teamTasks.length === 0 ? <p className="focus-empty">No shared tasks yet. Use <strong>Add task → Shared</strong> to invite a friend.</p> : <div className="shared-task-list">
                {teamTasks.map((task) => <article className={`shared-task-card task-${task.status.toLowerCase()}`} key={task.id}>
                  <div className="shared-task-icon">{task.status === 'Complete' ? '🏆' : task.status === 'Dropped' ? '🌱' : '📚'}</div>
                  <div className="shared-task-copy"><span className="shared-task-status">{task.status === 'Complete' ? 'WIN CELEBRATED' : task.status === 'Dropped' ? 'SAVED FOR LATER' : 'IN PROGRESS'}</span><h4>{task.title}</h4><p>👥 {task.memberNames ? task.memberNames.join(' & ') : 'Study team'} <span>·</span> 📅 {task.dueDate === 'Upcoming' ? 'No date set' : task.dueDate}</p></div>
                  <div className="shared-task-actions"><span className={`task-status-pill status-${task.status.toLowerCase()}`}>{task.status === 'Complete' ? '✓ Done' : task.status === 'Dropped' ? 'Paused' : 'On track'}</span><select aria-label={`Update ${task.title} status`} value={task.status} onChange={(e) => updateTeamTaskStatus(task.id, e.target.value)}>
                    <option value="Ongoing">In progress</option><option value="Complete">Complete</option><option value="Dropped">Save for later</option>
                  </select></div>
                </article>)}
              </div>}
            </div>
          </>
        )}

        {activeTab === 'posts' && <section className="community-page">
          <div className="community-hero"><div><span className="hero-eyebrow">THE GYANAEGIS COMMUNITY</span><h2>Share what’s on your mind ✨</h2><p>Celebrate a win, share a study tip, or cheer someone on. Your post is visible to everyone on Gyanaegis.</p></div><span className="community-hero-art" aria-hidden="true">🌈</span></div>
          <form className="post-composer study-panel" onSubmit={publishPost}>
            <div className="post-author-line"><span className="post-avatar post-avatar-you">{currentUser.username.slice(0, 1).toUpperCase()}</span><div><strong>{currentUser.username}</strong><small>Posting to everyone</small></div></div>
            <textarea aria-label="Write a post" placeholder="What would you like to share with the community?" value={postText} onChange={(e) => setPostText(e.target.value.slice(0, 1000))} maxLength={1000} rows={4} />
            <div className="post-compose-footer"><span className="post-visibility">🌍 Everyone can see this</span><div>{postError && <span className="post-error" role="alert">{postError}</span>}<span className="post-character-count">{postText.length}/1000</span><button className="colorful-button post-submit" type="submit" style={styles.button} disabled={!postText.trim() || postSubmitting}>{postSubmitting ? 'Posting…' : 'Share post'} <span>➤</span></button></div></div>
          </form>
          <div className="community-feed-heading"><div><span className="section-kicker">FROM YOUR COMMUNITY</span><h3>Latest posts</h3></div><span className="post-feed-count">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</span></div>
          <div className="community-feed" aria-live="polite">
            {postsLoading && posts.length === 0 ? <div className="feed-empty"><span>⏳</span><p>Loading community posts…</p></div> : postsLoadError && posts.length === 0 ? <div className="feed-empty"><span>⚠️</span><p>{postsLoadError}</p></div> : posts.length === 0 ? <div className="feed-empty"><span>🌱</span><h4>Be the first to post</h4><p>Share a little encouragement or a study win to get the conversation started.</p></div> : posts.map((post, index) => <article className="community-post" key={post.id}>
              <span className={`post-avatar post-avatar-${index % 4}`}>{post.author.slice(0, 1).toUpperCase()}</span>
              <div className="community-post-body"><header><div><strong>{post.author}</strong><time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time></div><span className="post-public-badge">🌍 Public</span></header><p>{post.text}</p></div>
            </article>)}
          </div>
        </section>}

        {activeTab === 'friends' && (
          <div className="social-page">
            <div className="social-hero">
              <div><span className="hero-eyebrow">YOUR PEOPLE, YOUR PROGRESS</span><h2>Study feels better together 💬</h2><p>Catch up with friends, share a little encouragement, and keep each other moving.</p></div>
              <div className="social-hero-art" aria-hidden="true">💌</div>
            </div>
            <div className="social-layout">
              <aside className="friend-sidebar study-panel">
                <div className="section-heading"><div><span className="section-kicker">YOUR CIRCLE</span><h3>Friends <span className="count-bubble">{acceptedFriends.length}</span></h3></div><span className="heading-sticker">🫶</span></div>
                <form className="friend-add-form" onSubmit={sendFriendRequest}>
                  <label htmlFor="friend-username">Add a study buddy</label>
                  <div className="friend-add-row"><input id="friend-username" type="text" placeholder="Friend’s username" style={styles.input} value={friendUsernameInput} onChange={(e) => setFriendUsernameInput(e.target.value)} required /><button className="colorful-button" type="submit" style={styles.button} aria-label="Send friend request">+</button></div>
                </form>
                {friendError && <p className="social-alert social-alert-error" role="alert">{friendError}</p>}
                {friendSuccess && <p className="social-alert social-alert-success" role="status">{friendSuccess}</p>}

                {pendingRequests.length > 0 && <div className="request-section">
                  <span className="sidebar-label">NEW REQUESTS <span>{pendingRequests.length}</span></span>
                  {pendingRequests.map((req) => <div className="request-card" key={req.id}><span className="friend-avatar avatar-coral">{req.senderUsername.slice(0, 1).toUpperCase()}</span><div className="request-copy"><strong>{req.senderUsername}</strong><small>wants to connect</small></div><button type="button" className="accept-button" onClick={() => acceptFriendRequest(req.id)}>Accept</button></div>)}
                </div>}

                <div className="friend-list-heading"><span className="sidebar-label">YOUR FRIENDS</span><span className="online-note">{acceptedFriends.length ? '✦ Ready to chat' : ''}</span></div>
                <div className="friend-list">
                  {acceptedFriends.length === 0 ? <div className="sidebar-empty"><span>🌱</span><p>Your circle starts here.<br />Add a friend by username.</p></div> : acceptedFriends.map((friend, index) => <button
                    className={`friend-row ${selectedFriend?.friendId === friend.friendId ? 'friend-selected' : ''}`}
                    key={friend.id}
                    type="button"
                    onClick={() => { setSelectedFriend(friend); fetchMessages(friend.friendId); }}
                  >
                    <span className={`friend-avatar avatar-${index % 4}`}>{friend.friendUsername.slice(0, 1).toUpperCase()}</span>
                    <span className="friend-row-copy"><strong>{friend.friendUsername}</strong><small>{selectedFriend?.friendId === friend.friendId ? 'Chat is open' : 'Study buddy'}</small></span>
                    <span className="friend-row-arrow">›</span>
                  </button>)}
                </div>
              </aside>

              <section className="chat-panel study-panel" aria-label="Friend chat">
                {selectedFriend ? <>
                  <div className="chat-header">
                    <span className="friend-avatar avatar-chat">{selectedFriend.friendUsername.slice(0, 1).toUpperCase()}</span>
                    <div className="chat-header-copy"><span className="section-kicker">YOUR STUDY BUDDY</span><h3>{selectedFriend.friendUsername}</h3></div>
                    <span className="chat-connected">✦ Connected</span>
                  </div>
                  <div className="chat-thread" aria-live="polite" ref={chatThreadRef}>
                    {messages.length === 0 ? <div className="chat-empty"><span>👋</span><h4>Say hello to {selectedFriend.friendUsername}</h4><p>A little encouragement can make someone’s day.</p></div> : messages.map((message) => {
                      const mine = message.senderId === currentUser.id;
                      const time = new Date(message.timestamp);
                      return <div className={`message-row ${mine ? 'message-row-mine' : ''}`} key={message._id || message.id}>
                        {!mine && <span className="message-avatar">{selectedFriend.friendUsername.slice(0, 1).toUpperCase()}</span>}
                        <div className={`message-bubble ${mine ? 'message-mine' : 'message-theirs'}`}><p>{message.text}</p><span>{Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
                      </div>;
                    })}
                  </div>
                  <form className="chat-compose" onSubmit={sendMessage}>
                    <input type="text" aria-label="Message" placeholder={`Write a kind note to ${selectedFriend.friendUsername}…`} style={styles.input} value={newMessageText} onChange={(e) => setNewMessageText(e.target.value)} required />
                    <button className="chat-send-button" type="submit" aria-label="Send message">Send <span>➤</span></button>
                  </form>
                </> : <div className="chat-placeholder"><div className="chat-placeholder-art">💬</div><span className="section-kicker">A LITTLE CONNECTION GOES A LONG WAY</span><h3>Choose a friend to start chatting</h3><p>Your conversations with study buddies will show up here.</p></div>}
              </section>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#0f172a', minHeight: '100vh', color: '#f8fafc', fontFamily: 'sans-serif' },
  loginContainer: { backgroundColor: '#0f172a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' },
  loginCard: { backgroundColor: '#1e293b', padding: '2.5rem', borderRadius: '12px', border: '1px solid #334155', width: '100%', maxWidth: '400px', textAlign: 'center' },
  logoIcon: { fontSize: '2.5rem', backgroundColor: '#0f172a', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', margin: '0 auto', border: '1px solid #334155' },
  header: { backgroundColor: '#1e293b', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155' },
  navBar: { backgroundColor: '#1e293b', display: 'flex', padding: '0 2rem', borderBottom: '1px solid #334155', gap: '1rem' },
  navTab: { background: 'none', border: 'none', padding: '1rem 1.5rem', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' },
  activeTab: { color: '#38bdf8', borderBottom: '3px solid #38bdf8' },
  logoText: { margin: 0, fontSize: '1.5rem', color: '#38bdf8' },
  userBadge: { backgroundColor: '#334155', padding: '0.4rem 0.8rem', borderRadius: '20px', fontSize: '0.85rem' },
  accountBtn: { padding: '0.4rem 0.8rem', backgroundColor: '#334155', border: '1px solid #475569', borderRadius: '6px', color: '#e2e8f0', cursor: 'pointer', fontSize: '0.8rem' },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(2, 6, 23, 0.8)', padding: '1rem' },
  modalCard: { width: '100%', maxWidth: '440px', backgroundColor: '#1e293b', padding: '2rem', borderRadius: '12px', border: '1px solid #475569', boxShadow: '0 20px 40px rgba(0,0,0,0.35)' },
  logoutBtn: { padding: '0.4rem 0.8rem', backgroundColor: '#ef4444', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' },
  switchBtn: { background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', textDecoration: 'underline', fontWeight: 'bold' },
  errorAlert: { backgroundColor: '#7f1d1d', color: '#fca5a5', padding: '0.6rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem', border: '1px solid #991b1b' },
  successAlert: { backgroundColor: '#064e3b', color: '#a7f3d0', padding: '0.6rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem', border: '1px solid #047857' },
  main: { padding: '2rem', maxWidth: '1100px', margin: '0 auto' },
  welcomeCard: { background: 'linear-gradient(135deg, #2563eb, #4f46e5)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
  statCard: { backgroundColor: '#1e293b', padding: '1rem', borderRadius: '10px', border: '1px solid #334155' },
  statLabel: { margin: 0, color: '#94a3b8', fontSize: '0.85rem' },
  statValue: { margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold' },
  taskSection: { backgroundColor: '#1e293b', padding: '1.5rem', borderRadius: '12px', border: '1px solid #334155' },
  taskForm: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' },
  input: { flex: 1, minWidth: '180px', padding: '0.6rem 1rem', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#fff' },
  actionSelect: { padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' },
  button: { padding: '0.6rem 1.2rem', backgroundColor: '#2563eb', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontWeight: 'bold' },
  taskList: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  taskItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', borderBottom: '1px solid #334155' },
  taskSubtext: { margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' },
  statusBadge: { padding: '0.25rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }
};

export default App;
