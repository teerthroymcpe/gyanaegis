import { useEffect, useRef, useState } from 'react';
import api from './api';
import { compressPostPhoto } from './components/helpers';

export default function useWorkspace({ currentUser, setCurrentUser }) {
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
  const [acceptingRequestId, setAcceptingRequestId] = useState('');
  const [selectedFriend, setSelectedFriend] = useState(null);

  const [messages, setMessages] = useState([]);
  const [newMessageText, setNewMessageText] = useState('');
  const chatThreadRef = useRef(null);
  const [posts, setPosts] = useState([]);
  const [postText, setPostText] = useState('');
  const [postImage, setPostImage] = useState('');
  const [postError, setPostError] = useState('');
  const [postsLoadError, setPostsLoadError] = useState('');
  const [postsLoading, setPostsLoading] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [editingPostId, setEditingPostId] = useState('');
  const [editingPostText, setEditingPostText] = useState('');
  const [editingPostImage, setEditingPostImage] = useState('');
  const [postSavingId, setPostSavingId] = useState('');
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileReturnTab, setProfileReturnTab] = useState('posts');
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDraftBio, setProfileDraftBio] = useState('');
  const [profileDraftAvatar, setProfileDraftAvatar] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const [teamTasks, setTeamTasks] = useState([]);
  const [newTeamTaskTitle, setNewTeamTaskTitle] = useState('');
  const [newTeamTaskDueDate, setNewTeamTaskDueDate] = useState('');
  const [selectedTeamMember, setSelectedTeamMember] = useState('');
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
    if ((!text && !postImage) || postSubmitting) return;
    setPostError('');
    setPostSubmitting(true);
    try {
      const res = await api.post('/posts', { text, imageData: postImage });
      setPosts((items) => [res.data, ...items].slice(0, 100));
      setPostText('');
      setPostImage('');
    } catch (err) {
      setPostError(err.response?.data?.error || 'Could not publish your post.');
    } finally { setPostSubmitting(false); }
  };

  const choosePostPhoto = async (file, setImage) => {
    if (!file) return;
    setPostError('');
    try { setImage(await compressPostPhoto(file)); }
    catch (err) { setPostError(err.message || 'Could not add that photo.'); }
  };

  const beginPostEdit = (post) => {
    setEditingPostId(post.id);
    setEditingPostText(post.text || '');
    setEditingPostImage(post.imageData || '');
    setPostError('');
  };

  const savePostEdit = async (postId) => {
    setPostSavingId(postId);
    setPostError('');
    try {
      const res = await api.patch(`/posts/${postId}`, { text: editingPostText, imageData: editingPostImage });
      setPosts((items) => items.map((post) => post.id === postId ? { ...post, ...res.data } : post));
      setProfileData((profile) => profile ? { ...profile, posts: profile.posts.map((post) => post.id === postId ? { ...post, ...res.data } : post) } : profile);
      setEditingPostId('');
    } catch (err) {
      setPostError(err.response?.data?.error || 'Could not save your post.');
    } finally { setPostSavingId(''); }
  };

  const deletePost = async (postId) => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    setPostError('');
    try {
      await api.delete(`/posts/${postId}`);
      setPosts((items) => items.filter((post) => post.id !== postId));
      setProfileData((profile) => profile ? { ...profile, postCount: Math.max(0, profile.postCount - 1), posts: profile.posts.filter((post) => post.id !== postId) } : profile);
    } catch (err) {
      setPostError(err.response?.data?.error || 'Could not delete your post.');
    }
  };

  const openProfile = async (username) => {
    if (!username) return;
    setProfileReturnTab(activeTab === 'profile' ? profileReturnTab : activeTab);
    setActiveTab('profile');
    setProfileData(null);
    setProfileError('');
    setProfileLoading(true);
    try {
      const res = await api.get(`/profiles/${encodeURIComponent(username)}`);
      setProfileData(res.data);
    } catch (err) {
      setProfileError(err.response?.data?.error || 'Could not load this profile.');
    } finally { setProfileLoading(false); }
  };

  const startProfileEdit = () => {
    setProfileDraftName(profileData?.displayName || currentUser.displayName || currentUser.username);
    setProfileDraftBio(profileData?.bio || currentUser.bio || '');
    setProfileDraftAvatar(profileData?.avatarData || currentUser.avatarData || '');
    setProfileError('');
    setProfileEditOpen(true);
  };

  const selectProfilePhoto = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setProfileError('Choose an image file for your profile photo.');
    const reader = new FileReader();
    reader.onerror = () => setProfileError('Could not read that image.');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => setProfileError('Could not open that image.');
      image.onload = () => {
        const side = Math.min(image.width, image.height);
        const canvas = document.createElement('canvas');
        canvas.width = 288;
        canvas.height = 288;
        canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 288, 288);
        const photo = canvas.toDataURL('image/jpeg', 0.72);
        if (photo.length > 180000) return setProfileError('That photo is too large. Choose a smaller image.');
        setProfileDraftAvatar(photo);
        setProfileError('');
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileError('');
    try {
      const res = await api.put('/profile', { displayName: profileDraftName, bio: profileDraftBio, avatarData: profileDraftAvatar });
      setCurrentUser(res.data.user);
      setProfileData((profile) => ({ ...profile, ...res.data.user, username: currentUser.username.toLowerCase() }));
      setProfileEditOpen(false);
      fetchPosts();
    } catch (err) {
      setProfileError(err.response?.data?.error || 'Could not save your profile.');
    } finally { setProfileSaving(false); }
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

  const fetchFriendships = async () => {
    try {
      const res = await api.get(`/friends/${currentUser.id}`);
      setFriendships((existing) => {
        const alreadyAccepted = new Set(existing.filter((friend) => friend.status === 'accepted').map((friend) => friend.id));
        return res.data.map((friend) => alreadyAccepted.has(friend.id) ? { ...friend, status: 'accepted' } : friend);
      });
      return true;
    } catch (err) {
      console.error(err);
      return false;
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
    setFriendError('');
    setFriendSuccess('');
    setAcceptingRequestId(requestId);
    try {
      await api.post('/friends/accept', { requestId });
      setFriendships((existing) => existing.map((friend) => friend.id === requestId ? { ...friend, status: 'accepted' } : friend));
      if (!await fetchFriendships()) throw new Error('Could not refresh your friends list. Please refresh the page.');
      setFriendSuccess('Friend request accepted. You can now chat and share tasks.');
    } catch (err) { setFriendError(err.response?.data?.error || err.message || 'Could not accept this friend request. Please refresh and try again.'); }
    finally { setAcceptingRequestId(''); }
  };

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

  const resetWorkspace = () => {
    setActiveTab('dashboard');
    setTasks([]);
    setStudyGoals([]);
    setDailyPlan({ tasks: [], score: 0, totalCompleted: 0 });
    setFriendships([]);
    setSelectedFriend(null);
    setMessages([]);
    setPosts([]);
    setPostText('');
    setPostImage('');
    setPostError('');
    setTeamTasks([]);
  };

  const acceptedFriends = friendships.filter(f => f.status === 'accepted');
  const pendingRequests = friendships.filter(f => f.status === 'pending' && f.receiverId === currentUser?.id);
  const personalTasks = tasks.filter((task) => !task.goalId);
  const completedStudyTasks = dailyPlan.tasks.filter((task) => task.status === 'Complete').length;
  const studyProgress = dailyPlan.tasks.length ? Math.round((completedStudyTasks / dailyPlan.tasks.length) * 100) : 0;
  const completedTeamTasks = teamTasks.filter((task) => task.status === 'Complete').length;
  const taskCount = dailyPlan.tasks.length + personalTasks.length + teamTasks.length;
  const completedTaskCount = completedStudyTasks + personalTasks.filter((task) => task.status === 'Complete').length + completedTeamTasks;

  return {
    activeTab, setActiveTab, tasks, setTasks, newTaskTitle, setNewTaskTitle, newTaskDueDate, setNewTaskDueDate, studyGoals, dailyPlan, setDailyPlan,
    goalTitle, setGoalTitle, goalTargetDate, setGoalTargetDate, goalSubjects, setGoalSubjects, goalMinutes, setGoalMinutes, goalError, setGoalError,
    goalSaving, taskComposerOpen, setTaskComposerOpen, composerType, setComposerType, taskFormError, setTaskFormError, timerNow, timerError,
    friendships, setFriendships, friendUsernameInput, setFriendUsernameInput, friendError, friendSuccess, acceptingRequestId, selectedFriend,
    setSelectedFriend, messages, setMessages, newMessageText, setNewMessageText, chatThreadRef, posts, setPosts, postText, setPostText,
    postImage, setPostImage, postError, postsLoadError, postsLoading, postSubmitting, editingPostId, setEditingPostId,
    editingPostText, setEditingPostText, editingPostImage, setEditingPostImage, postSavingId, profileData, setProfileData,
    profileLoading, profileError, setProfileError, profileReturnTab, setProfileReturnTab, profileEditOpen, setProfileEditOpen,
    profileDraftName, setProfileDraftName, profileDraftBio, setProfileDraftBio, profileDraftAvatar, setProfileDraftAvatar,
    profileSaving, teamTasks, newTeamTaskTitle, setNewTeamTaskTitle, newTeamTaskDueDate, setNewTeamTaskDueDate,
    selectedTeamMember, setSelectedTeamMember, acceptedFriends, pendingRequests, personalTasks, completedStudyTasks, studyProgress,
    completedTeamTasks, taskCount, completedTaskCount, fetchPosts, publishPost, choosePostPhoto, beginPostEdit, savePostEdit,
    deletePost, openProfile, startProfileEdit, selectProfilePhoto, saveProfile, localDate, getTaskSecondsLeft, formatTimer,
    getTimerProgress, getDaysRemaining, updateStudyTimer, createStudyGoal, addTask, updateTaskStatus, fetchFriendships,
    sendFriendRequest, acceptFriendRequest, fetchMessages, sendMessage, fetchTeamTasks, addTeamTask, updateTeamTaskStatus,
    resetWorkspace
  };
}
