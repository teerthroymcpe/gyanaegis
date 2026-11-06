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
    } catch (err) {
      setGoalError(err.response?.data?.error || 'Could not create your study goal.');
    } finally { setGoalSaving(false); }
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !currentUser) return;

    try {
      const res = await api.post('/tasks', {
        title: newTaskTitle.trim(),
        userId: currentUser.id,
        dueDate: newTaskDueDate || 'Upcoming'
      });
      setTasks([...tasks, res.data]);
      setNewTaskTitle('');
      setNewTaskDueDate('');
    } catch (err) {
      console.error(err);
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
    if (!newTeamTaskTitle.trim() || !selectedTeamMember) return;

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
    } catch (err) {
      console.error(err);
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
  const completedStudyTasks = dailyPlan.tasks.filter((task) => task.status === 'Complete').length;
  const studyProgress = dailyPlan.tasks.length ? Math.round((completedStudyTasks / dailyPlan.tasks.length) * 100) : 0;

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

      <nav className="app-nav" style={styles.navBar}>
        <button className={`nav-pill ${activeTab === 'dashboard' ? 'is-active' : ''}`} style={{ ...styles.navTab, ...(activeTab === 'dashboard' ? styles.activeTab : {}) }} onClick={() => setActiveTab('dashboard')}>📊 <span>My Dashboard</span></button>
        <button className={`nav-pill ${activeTab === 'friends' ? 'is-active' : ''}`} style={{ ...styles.navTab, ...(activeTab === 'friends' ? styles.activeTab : {}) }} onClick={() => setActiveTab('friends')}>💬 <span>Friends & Chat {pendingRequests.length > 0 && `(${pendingRequests.length})`}</span></button>
        <button className={`nav-pill ${activeTab === 'teams' ? 'is-active' : ''}`} style={{ ...styles.navTab, ...(activeTab === 'teams' ? styles.activeTab : {}) }} onClick={() => setActiveTab('teams')}>🤝 <span>Team Tasks</span></button>
      </nav>

      <main className="main-content" style={styles.main}>
        {activeTab === 'dashboard' && (
          <>
            <div className="dashboard-hero" style={styles.welcomeCard}>
              <div className="hero-copy">
                <span className="hero-eyebrow">YOUR PERSONAL STUDY SPACE</span>
                <h2>Your next step starts today, {currentUser.username} 🌱</h2>
                <p>Small, steady sessions add up. Set a goal and we’ll help you keep moving.</p>
                <span className="hero-note">✨ One focused session at a time</span>
              </div>
              <div className="hero-art" aria-hidden="true"><span className="hero-orbit">✦</span><span className="hero-book">📚</span><span className="hero-spark">✧</span></div>
            </div>

            <div className="dashboard-stats" style={styles.statsGrid}>
              <div className="metric-card metric-points" style={styles.statCard}>
                <div className="metric-icon">⭐</div><div>
                <p style={styles.statLabel}>Study points earned</p>
                <p style={styles.statValue}>{dailyPlan.score}</p></div>
              </div>
              <div className="metric-card metric-sessions" style={styles.statCard}>
                <div className="metric-icon">📖</div><div>
                <p style={styles.statLabel}>Study sessions completed</p>
                <p style={styles.statValue}>{dailyPlan.totalCompleted}</p></div>
              </div>
              <div className="metric-card metric-progress" style={styles.statCard}>
                <div className="metric-icon">🌈</div><div>
                <p style={styles.statLabel}>Today’s progress</p>
                <p style={styles.statValue}>{completedStudyTasks}<span className="metric-total"> / {dailyPlan.tasks.length}</span></p></div>
              </div>
            </div>

            <div className="study-panel goals-panel" style={styles.taskSection}>
              <div className="section-heading"><div><span className="section-kicker">MAKE IT YOURS</span><h3>Your study goals</h3></div><span className="heading-sticker">🎯</span></div>
              {studyGoals.length > 0 && <div className="goal-chip-list" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', margin: '1rem 0' }}>
                {studyGoals.map((goal) => <span className="goal-chip" key={goal.id} style={{ ...styles.statusBadge, backgroundColor: '#1d4ed8', padding: '0.45rem 0.8rem' }}>
                  🎯 {goal.title} · {goal.targetDate ? `📅 ${getDaysRemaining(goal.targetDate) === 0 ? 'Due today' : `${getDaysRemaining(goal.targetDate)} days left`} · ${new Date(`${goal.targetDate}T00:00:00`).toLocaleDateString()}` : '📅 No deadline set'}
                </span>)}
              </div>}
              <form className="goal-form" onSubmit={createStudyGoal} style={{ ...styles.taskForm, marginTop: '1rem' }}>
                <input className="colorful-input goal-title-input" type="text" placeholder="What are you preparing for? (e.g. Biology exam)" style={styles.input} value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} maxLength={120} required />
                <input className="colorful-input" type="date" aria-label="Target date (optional)" title="Target date (optional)" style={styles.input} value={goalTargetDate} min={localDate()} onChange={(e) => setGoalTargetDate(e.target.value)} />
                <input className="colorful-input goal-subject-input" type="text" placeholder="Subjects or topics, separated by commas (optional)" style={styles.input} value={goalSubjects} onChange={(e) => setGoalSubjects(e.target.value)} />
                <select className="colorful-input" aria-label="Daily study time" style={styles.actionSelect} value={goalMinutes} onChange={(e) => setGoalMinutes(e.target.value)}>
                  <option value="30">30 minutes a day</option><option value="60">1 hour a day</option><option value="90">1.5 hours a day</option><option value="120">2 hours a day</option><option value="180">3 hours a day</option>
                </select>
                <button className="colorful-button create-goal-button" type="submit" style={styles.button} disabled={goalSaving}>{goalSaving ? 'Saving…' : '+ Create study goal'}</button>
              </form>
              {goalError && <p className="form-error" style={{ color: '#fca5a5', marginTop: 0 }}>{goalError}</p>}
            </div>

            <div className="study-panel plan-panel" style={{ ...styles.taskSection, marginTop: '1.5rem' }}>
              <div className="section-heading plan-heading"><div><span className="section-kicker">YOUR DAILY RHYTHM</span><h3>Today’s study plan</h3><p>Short, focused sessions are a win. Pause anytime; points arrive when the timer ends.</p></div><span className="plan-date-chip">☀️ Today</span></div>
              <div className="daily-progress-wrap"><div className="daily-progress-label"><span>Today’s progress</span><strong>{studyProgress}%</strong></div><div className="daily-progress-track"><div className="daily-progress-fill" style={{ width: `${studyProgress}%` }} /></div></div>
              {timerError && <p role="alert" style={{ color: '#fca5a5' }}>{timerError}</p>}
              <div className="study-session-list" style={styles.taskList}>
                {dailyPlan.tasks.length === 0 ? (
                  <p style={{ color: '#94a3b8', textAlign: 'center', margin: '1.5rem 0' }}>{studyGoals.length ? 'Your next daily plan will be ready on your study date.' : 'Create a study goal above and we’ll build your first daily plan.'}</p>
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
              <div className="section-heading"><div><span className="section-kicker">OTHER THINGS TO DO</span><h3>Personal tasks</h3></div><span className="heading-sticker">📝</span></div>
              <form className="goal-form personal-task-form" onSubmit={addTask} style={styles.taskForm}>
                <input type="text" placeholder="Add a one-off task..." style={styles.input} value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} required />
                <input type="date" aria-label="Task due date" style={styles.input} value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} />
                <button type="submit" style={styles.button}>+ Add task</button>
              </form>
              <div style={styles.taskList}>
                {tasks.filter((task) => !task.goalId).map((task) => (
                  <div key={task.id} style={styles.taskItem}>
                    <div><strong>{task.title}</strong><p style={styles.taskSubtext}>Due: {task.dueDate}</p></div>
                    <select aria-label={`Status for ${task.title}`} style={styles.actionSelect} value={task.status} onChange={(e) => updateTaskStatus(task.id, e.target.value)}>
                      <option value="Ongoing">Ongoing</option><option value="Complete">Complete</option><option value="Dropped">Dropped</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'friends' && (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem', alignItems: 'start' }}>
            <div style={styles.taskSection}>
              <h3>Add Friend</h3>
              <form onSubmit={sendFriendRequest} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input type="text" placeholder="Friend's Username..." style={styles.input} value={friendUsernameInput} onChange={(e) => setFriendUsernameInput(e.target.value)} required />
                <button type="submit" style={styles.button}>Add</button>
              </form>
              {friendError && <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{friendError}</p>}
              {friendSuccess && <p style={{ color: '#34d399', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{friendSuccess}</p>}

              {pendingRequests.length > 0 && (
                <div style={{ marginBottom: '1.5rem', marginTop: '1rem' }}>
                  <h4>Pending Incoming Requests</h4>
                  {pendingRequests.map(req => (
                    <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', background: '#334155', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                      <span style={{ fontSize: '0.85rem' }}>From: <strong>{req.senderUsername}</strong></span>
                      <button onClick={() => acceptFriendRequest(req.id)} style={{ ...styles.button, padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Accept</button>
                    </div>
                  ))}
                </div>
              )}

              <h4 style={{ marginTop: '1.5rem' }}>My Friends</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                {acceptedFriends.length === 0 ? (
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No friends added yet.</p>
                ) : (
                  acceptedFriends.map(f => (
                    <div
                      key={f.id}
                      onClick={() => {
                        setSelectedFriend(f);
                        fetchMessages(f.friendId);
                      }}
                      style={{ padding: '0.75rem', borderRadius: '8px', cursor: 'pointer', backgroundColor: selectedFriend?.friendId === f.friendId ? '#2563eb' : '#334155' }}
                    >
                      👤 <strong>{f.friendUsername}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ ...styles.taskSection, display: 'flex', flexDirection: 'column', height: '520px' }}>
              {selectedFriend ? (
                <>
                  <h3 style={{ borderBottom: '1px solid #334155', paddingBottom: '0.75rem', marginBottom: '1rem' }}>Chat with <strong>{selectedFriend.friendUsername}</strong></h3>
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.5rem' }}>
                    {messages.length === 0 ? (
                      <p style={{ color: '#94a3b8', textAlign: 'center', margin: 'auto' }}>No messages yet. Say hello!</p>
                    ) : (
                      messages.map(msg => (
                        <div key={msg._id || msg.id} style={{ alignSelf: msg.senderId === currentUser.id ? 'flex-end' : 'flex-start', backgroundColor: msg.senderId === currentUser.id ? '#2563eb' : '#334155', padding: '0.6rem 1rem', borderRadius: '10px', maxWidth: '75%' }}>
                          <p style={{ margin: 0, fontSize: '0.95rem' }}>{msg.text}</p>
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', textAlign: 'right', marginTop: '0.2rem' }}>{msg.timestamp}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={sendMessage} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                    <input type="text" placeholder="Type a message..." style={styles.input} value={newMessageText} onChange={(e) => setNewMessageText(e.target.value)} required />
                    <button type="submit" style={styles.button}>Send</button>
                  </form>
                </>
              ) : (
                <div style={{ margin: 'auto', textAlign: 'center', color: '#94a3b8' }}>
                  <h3>Select a friend from the left sidebar to start chatting</h3>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'teams' && (
          <div style={styles.taskSection}>
            <h3>Create Shared Team Task</h3>
            <form onSubmit={addTeamTask} style={styles.taskForm}>
              <input type="text" placeholder="Team Task Title..." style={styles.input} value={newTeamTaskTitle} onChange={(e) => setNewTeamTaskTitle(e.target.value)} required />
              <select style={styles.input} value={selectedTeamMember} onChange={(e) => setSelectedTeamMember(e.target.value)} required>
                <option value="">Select Friend Partner...</option>
                {acceptedFriends.map(f => (
                  <option key={f.friendId} value={f.friendId}>{f.friendUsername}</option>
                ))}
              </select>
              <input type="date" style={styles.input} value={newTeamTaskDueDate} onChange={(e) => setNewTeamTaskDueDate(e.target.value)} />
              <button type="submit" style={styles.button}>+ Create Team Task</button>
            </form>

            <h3 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Shared Team Tasks</h3>
            <div style={styles.taskList}>
              {teamTasks.length === 0 ? (
                <p style={{ color: '#94a3b8', textAlign: 'center', margin: '1.5rem 0' }}>No team tasks found.</p>
              ) : (
                teamTasks.map((task) => (
                  <div key={task.id} style={styles.taskItem}>
                    <div>
                      <strong>{task.title}</strong>
                      <p style={styles.taskSubtext}>Members: {task.memberNames ? task.memberNames.join(', ') : 'Team'} | Due: {task.dueDate}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ ...styles.statusBadge, backgroundColor: task.status === 'Complete' ? '#059669' : task.status === 'Dropped' ? '#DC2626' : '#D97706' }}>
                        {task.status}
                      </span>
                      <select style={styles.actionSelect} value={task.status} onChange={(e) => updateTeamTaskStatus(task.id, e.target.value)}>
                        <option value="Ongoing">Ongoing</option>
                        <option value="Complete">Complete</option>
                        <option value="Dropped">Dropped</option>
                      </select>
                    </div>
                  </div>
                ))
              )}
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
