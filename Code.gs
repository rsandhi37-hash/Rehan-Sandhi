// ============================================
// NOOR.IN SHAYARI PLATFORM - BACKEND
// ============================================

// 🔧 CONFIGURATION
const CONFIG = {
  // Limits
  MAX_SHAYARI_LENGTH: 500,
  SHAYARI_PER_PAGE: 10,
  POST_LIMIT_SECONDS: 30,
  SEARCH_MIN_LENGTH: 2,
  MAX_SEARCH_RESULTS: 100,
  SESSION_TTL: 86400, // 24 hours in seconds
  
  // Spreadsheet sheet names
  USERS_SHEET: 'USERS',
  SHAYARI_SHEET: 'SHAYARI',
  FOLLOWS_SHEET: 'FOLLOWS',
  SAVES_SHEET: 'SAVES',
  LIKES_SHEET: 'LIKES',
  COMMENTS_SHEET: 'COMMENTS',
  REPORTS_SHEET: 'REPORTS',
  BLOCKS_SHEET: 'BLOCKS',
  SETTINGS_SHEET: 'SETTINGS'
};

// 📊 SPREADSHEET STRUCTURE
const SHEET_HEADERS = {
  USERS: ['Username', 'Email', 'PasswordHash', 'Salt', 'CreatedAt', 'LastLogin', 'IsPremium', 'PremiumUntil', 'ProfilePic', 'Bio', 'Privacy'],
  SHAYARI: ['ID', 'Username', 'Text', 'Category', 'Likes', 'Comments', 'Saves', 'Views', 'IsDeleted', 'CreatedAt', 'UpdatedAt'],
  FOLLOWS: ['Follower', 'Following', 'CreatedAt'],
  SAVES: ['Username', 'ShayariID', 'CreatedAt'],
  LIKES: ['Username', 'ShayariID', 'CreatedAt'],
  COMMENTS: ['ID', 'ShayariID', 'Username', 'Text', 'CreatedAt', 'IsDeleted'],
  REPORTS: ['ID', 'ShayariID', 'Username', 'Reason', 'Status', 'CreatedAt'],
  BLOCKS: ['Blocker', 'Blocked', 'CreatedAt'],
  SETTINGS: ['Username', 'Key', 'Value', 'UpdatedAt']
};

// 🗃️ GET SPREADSHEET
function getSpreadsheet() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    const scriptProperties = PropertiesService.getScriptProperties();
    const spreadsheetId = scriptProperties.getProperty('SPREADSHEET_ID');
    if (spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }
    throw new Error('Spreadsheet not found. Please run initializeSheets() first.');
  }
}

// 🔐 GET USER PROPERTIES STORE
function getUserStore() {
  return PropertiesService.getScriptProperties();
}

// 🔐 GET CACHE SERVICE
function getCache() {
  return CacheService.getScriptCache();
}

// 🔐 PASSWORD HASHING
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = Utilities.getUuid();
  }
  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + salt
  );
  const hashStr = hash.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  return { hash: hashStr, salt: salt };
}

// ✅ SANITIZE TEXT
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .replace(/[&<>"']/g, function(m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m];
    })
    .substring(0, CONFIG.MAX_SHAYARI_LENGTH)
    .trim();
}

// 🔐 GENERATE SESSION TOKEN
function generateSessionToken() {
  return Utilities.getUuid() + '-' + Date.now();
}

// 🔐 GENERATE SHAYARI ID
function generateShayariId() {
  return 'SH' + Date.now() + Math.random().toString(36).substr(2, 9);
}

// 🔐 GENERATE COMMENT ID
function generateCommentId() {
  return 'CM' + Date.now() + Math.random().toString(36).substr(2, 9);
}

// 🔐 GENERATE REPORT ID
function generateReportId() {
  return 'RP' + Date.now() + Math.random().toString(36).substr(2, 9);
}

// 👤 GET CURRENT USER
function getCurrentUser(sessionToken) {
  try {
    if (!sessionToken || typeof sessionToken !== 'string') {
      return { success: false, message: 'No active session' };
    }
    
    const store = getUserStore();
    const cache = getCache();
    
    // Check cache first
    const cacheKey = 'session_' + sessionToken;
    const cachedUser = cache.get(cacheKey);
    if (cachedUser) {
      try {
        const userData = JSON.parse(cachedUser);
        return { 
          success: true, 
          message: 'User found in cache',
          data: userData
        };
      } catch (e) {
        cache.remove(cacheKey);
      }
    }
    
    // Check script properties
    const username = store.getProperty(cacheKey);
    if (!username) {
      return { success: false, message: 'Session expired or invalid' };
    }
    
    // Get user details from spreadsheet
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'Users sheet not found' };
    }
    
    const data = userSheet.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === username.toLowerCase()) {
        const user = {
          username: data[i][0],
          email: data[i][1],
          createdAt: data[i][4],
          lastLogin: data[i][5],
          isPremium: data[i][6] === 'TRUE',
          premiumUntil: data[i][7],
          profilePic: data[i][8],
          bio: data[i][9],
          privacy: data[i][10] || 'public'
        };
        
        // Cache user
        cache.put(cacheKey, JSON.stringify(user), CONFIG.SESSION_TTL);
        
        return { 
          success: true, 
          message: 'User found',
          data: user 
        };
      }
    }
    
    // Clean up invalid session
    store.deleteProperty(cacheKey);
    cache.remove(cacheKey);
    store.deleteProperty('user_session_' + username);
    
    return { success: false, message: 'User account not found' };
    
  } catch (error) {
    console.error('getCurrentUser error:', error);
    return { 
      success: false, 
      message: 'Server error: ' + error.toString() 
    };
  }
}

// 📝 SIGNUP USER
function signupUser(username, email, password) {
  try {
    // Normalize
    username = username.toLowerCase().trim();
    email = email.toLowerCase().trim();
    
    // Input validation
    if (!username || !email || !password) {
      return { success: false, message: 'All fields are required' };
    }
    
    if (username.length < 3) {
      return { success: false, message: 'Username must be at least 3 characters' };
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return { success: false, message: 'Username can only contain letters, numbers and underscore' };
    }
    
    if (password.length < 6) {
      return { success: false, message: 'Password must be at least 6 characters' };
    }
    
    if (!email.includes('@') || !email.includes('.')) {
      return { success: false, message: 'Valid email required' };
    }
    
    // Check if user already exists
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'System not initialized. Please run initializeSheets() first.' };
    }
    
    const data = userSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === username) {
        return { success: false, message: 'Username already taken' };
      }
      if (data[i][1] && data[i][1].toLowerCase() === email) {
        return { success: false, message: 'Email already registered' };
      }
    }
    
    // Generate unique salt per user
    const hashResult = hashPassword(password);
    
    // Add user to sheet
    userSheet.appendRow([
      username,
      email,
      hashResult.hash,
      hashResult.salt,
      new Date().toISOString(),
      new Date().toISOString(),
      false, // IsPremium
      '', // PremiumUntil
      '', // ProfilePic
      '', // Bio
      'public' // Privacy
    ]);
    
    // Auto-login after signup
    const sessionToken = generateSessionToken();
    const store = getUserStore();
    const cache = getCache();
    
    const sessionKey = 'session_' + sessionToken;
    const userSessionKey = 'user_session_' + username;
    
    // Store session
    store.setProperty(sessionKey, username);
    store.setProperty(userSessionKey, sessionToken);
    
    const userData = {
      username: username,
      email: email,
      createdAt: new Date().toISOString(),
      isPremium: false,
      sessionToken: sessionToken
    };
    
    cache.put(sessionKey, JSON.stringify(userData), CONFIG.SESSION_TTL);
    
    return { 
      success: true, 
      message: 'Account created successfully!',
      data: userData
    };
    
  } catch (error) {
    console.error('signupUser error:', error);
    return { 
      success: false, 
      message: 'Signup failed: ' + error.toString() 
    };
  }
}

// 🔐 LOGIN USER
function loginUser(email, password) {
  try {
    email = email.toLowerCase().trim();
    
    if (!email || !password) {
      return { success: false, message: 'Email and password required' };
    }
    
    // Find user
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'System not initialized. Please sign up first.' };
    }
    
    const data = userSheet.getDataRange().getValues();
    
    let user = null;
    let userRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] && data[i][1].toLowerCase() === email) {
        user = {
          username: data[i][0],
          email: data[i][1],
          passwordHash: data[i][2],
          salt: data[i][3],
          createdAt: data[i][4],
          lastLogin: data[i][5],
          isPremium: data[i][6] === 'TRUE',
          premiumUntil: data[i][7],
          profilePic: data[i][8],
          bio: data[i][9],
          privacy: data[i][10] || 'public'
        };
        userRow = i;
        break;
      }
    }
    
    if (!user) {
      return { success: false, message: 'Invalid email or password' };
    }
    
    // Verify password with stored salt
    const hashResult = hashPassword(password, user.salt);
    if (hashResult.hash !== user.passwordHash) {
      return { success: false, message: 'Invalid email or password' };
    }
    
    // Update last login
    userSheet.getRange(userRow + 1, 6).setValue(new Date().toISOString());
    
    // Generate session token
    const sessionToken = generateSessionToken();
    const store = getUserStore();
    const cache = getCache();
    
    // Store session with username binding
    const sessionKey = 'session_' + sessionToken;
    const userSessionKey = 'user_session_' + user.username;
    
    // Remove any existing session for this user
    const oldToken = store.getProperty(userSessionKey);
    if (oldToken) {
      store.deleteProperty('session_' + oldToken);
      cache.remove('session_' + oldToken);
    }
    
    // Store new session
    store.setProperty(sessionKey, user.username);
    store.setProperty(userSessionKey, sessionToken);
    
    // Cache user data
    const userData = {
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      isPremium: user.isPremium,
      profilePic: user.profilePic,
      bio: user.bio,
      sessionToken: sessionToken
    };
    
    cache.put(sessionKey, JSON.stringify(userData), CONFIG.SESSION_TTL);
    
    return {
      success: true,
      message: 'Login successful',
      data: userData
    };
    
  } catch (error) {
    console.error('loginUser error:', error);
    return { 
      success: false, 
      message: 'Login failed: ' + error.toString() 
    };
  }
}

// 🚪 LOGOUT USER
function logoutUser(sessionToken) {
  try {
    if (!sessionToken) {
      return { success: true, message: 'Already logged out' };
    }
    
    const store = getUserStore();
    const cache = getCache();
    
    // Get username from session
    const username = store.getProperty('session_' + sessionToken);
    
    if (username) {
      // Remove all session references
      store.deleteProperty('session_' + sessionToken);
      store.deleteProperty('user_session_' + username);
      cache.remove('session_' + sessionToken);
    }
    
    return { success: true, message: 'Logged out successfully' };
    
  } catch (error) {
    console.error('logoutUser error:', error);
    return { success: false, message: 'Logout failed' };
  }
}

// 📝 POST SHAYARI
function postShayari(text, author, category, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to post shayari' };
    }
    
    const username = userResult.data.username;
    
    // Rate limiting
    const cache = getCache();
    const cacheKey = 'last_post_' + username;
    const lastPostTime = cache.get(cacheKey);
    
    if (lastPostTime) {
      const secondsSinceLastPost = (Date.now() - parseInt(lastPostTime)) / 1000;
      if (secondsSinceLastPost < CONFIG.POST_LIMIT_SECONDS) {
        const waitTime = Math.ceil(CONFIG.POST_LIMIT_SECONDS - secondsSinceLastPost);
        return { 
          success: false, 
          message: `Please wait ${waitTime} second${waitTime > 1 ? 's' : ''} before posting again` 
        };
      }
    }
    
    // Sanitize and validate
    const sanitizedText = sanitizeText(text);
    if (!sanitizedText || sanitizedText.length === 0) {
      return { success: false, message: 'Shayari cannot be empty' };
    }
    
    if (sanitizedText.length > CONFIG.MAX_SHAYARI_LENGTH) {
      return { 
        success: false, 
        message: `Shayari must be ${CONFIG.MAX_SHAYARI_LENGTH} characters or less` 
      };
    }
    
    // Validate category
    const validCategories = ['prem', 'dosti', 'virah', 'zindagi', 'allah', 'other'];
    if (!validCategories.includes(category)) {
      category = 'other';
    }
    
    // Generate shayari ID
    const shayariId = generateShayariId();
    const now = new Date().toISOString();
    
    // Save to spreadsheet
    const ss = getSpreadsheet();
    let shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    
    if (!shayariSheet) {
      return { success: false, message: 'Shayari sheet not found. Please run initializeSheets() first.' };
    }
    
    shayariSheet.appendRow([
      shayariId,
      username,
      sanitizedText,
      category,
      0, // Likes
      0, // Comments
      0, // Saves
      0, // Views
      false, // IsDeleted
      now, // CreatedAt
      now  // UpdatedAt
    ]);
    
    // Update rate limit cache
    cache.put(cacheKey, Date.now().toString(), CONFIG.POST_LIMIT_SECONDS);
    
    // Clear relevant caches
    clearCachePattern('all_shayari_*');
    clearCachePattern('user_shayari_' + username + '_*');
    clearCachePattern('category_' + category + '_*');
    clearCachePattern('search_*');
    
    return { 
      success: true, 
      message: 'Shayari posted successfully!',
      data: { 
        id: shayariId,
        username: username, 
        text: sanitizedText,
        category: category,
        timestamp: now 
      }
    };
    
  } catch (error) {
    console.error('postShayari error:', error);
    return { 
      success: false, 
      message: 'Failed to post shayari: ' + error.toString() 
    };
  }
}

// 📖 GET ALL SHAYARI
function getAllShayari(page = 1, filter = 'all', search = '', sessionToken = null) {
  try {
    const userResult = sessionToken ? getCurrentUser(sessionToken) : { success: false };
    const username = userResult.success ? userResult.data.username : null;
    
    const cache = getCache();
    const cacheKey = `shayari_${filter}_${search}_page_${page}_user_${username || 'guest'}`;
    
    // Try cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        return { 
          success: true, 
          message: 'Shayari loaded from cache',
          data: data.shayaris,
          totalLikes: data.totalLikes,
          pagination: data.pagination
        };
      } catch (e) {
        cache.remove(cacheKey);
      }
    }
    
    // Get from spreadsheet
    const ss = getSpreadsheet();
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    
    if (!shayariSheet) {
      return { success: true, message: 'No shayari found', data: [] };
    }
    
    const data = shayariSheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return { success: true, message: 'No shayari found', data: [] };
    }
    
    // Get blocked users if logged in
    let blockedUsers = [];
    if (username) {
      const blocksSheet = ss.getSheetByName(CONFIG.BLOCKS_SHEET);
      if (blocksSheet) {
        const blocksData = blocksSheet.getDataRange().getValues();
        for (let i = 1; i < blocksData.length; i++) {
          if (blocksData[i][0] && blocksData[i][0].toLowerCase() === username.toLowerCase()) {
            blockedUsers.push(blocksData[i][1].toLowerCase());
          }
        }
      }
    }
    
    // Process shayaris
    const allShayaris = [];
    let totalLikes = 0;
    
    for (let i = data.length - 1; i >= 1; i--) {
      // Skip deleted or empty shayaris
      if (data[i][8] === 'TRUE' || !data[i][1] || !data[i][2]) continue;
      
      // Skip blocked users' shayaris
      if (blockedUsers.includes(data[i][1].toLowerCase())) continue;
      
      // Apply search filter
      if (search && search.length >= CONFIG.SEARCH_MIN_LENGTH) {
        const searchLower = search.toLowerCase();
        const shayariText = (data[i][2] || '').toLowerCase();
        const shayariUser = (data[i][1] || '').toLowerCase();
        
        if (!shayariText.includes(searchLower) && !shayariUser.includes(searchLower)) {
          continue;
        }
      }
      
      // Apply category filter
      if (filter !== 'all' && filter !== 'trending') {
        if (data[i][3] !== filter) {
          continue;
        }
      }
      
      // Get likes count
      const likesCount = parseInt(data[i][4]) || 0;
      totalLikes += likesCount;
      
      // Check if user liked this shayari
      let userLiked = false;
      let userSaved = false;
      
      if (username) {
        // Check likes
        const likesSheet = ss.getSheetByName(CONFIG.LIKES_SHEET);
        if (likesSheet) {
          const likesData = likesSheet.getDataRange().getValues();
          for (let j = 1; j < likesData.length; j++) {
            if (likesData[j][0] && likesData[j][0].toLowerCase() === username.toLowerCase() &&
                likesData[j][1] === data[i][0]) {
              userLiked = true;
              break;
            }
          }
        }
        
        // Check saves
        const savesSheet = ss.getSheetByName(CONFIG.SAVES_SHEET);
        if (savesSheet) {
          const savesData = savesSheet.getDataRange().getValues();
          for (let j = 1; j < savesData.length; j++) {
            if (savesData[j][0] && savesData[j][0].toLowerCase() === username.toLowerCase() &&
                savesData[j][1] === data[i][0]) {
              userSaved = true;
              break;
            }
          }
        }
      }
      
      const shayari = {
        id: data[i][0],
        username: data[i][1],
        text: data[i][2],
        category: data[i][3] || 'other',
        likes: likesCount,
        comments: parseInt(data[i][5]) || 0,
        saves: parseInt(data[i][6]) || 0,
        views: parseInt(data[i][7]) || 0,
        isDeleted: data[i][8] === 'TRUE',
        createdAt: data[i][9],
        updatedAt: data[i][10],
        liked: userLiked,
        saved: userSaved,
        date: formatDate(data[i][9]),
        time: formatTime(data[i][9])
      };
      
      allShayaris.push(shayari);
      
      // Limit for performance
      if (allShayaris.length >= CONFIG.MAX_SEARCH_RESULTS * 2) {
        break;
      }
    }
    
    // Apply trending filter (sort by likes)
    if (filter === 'trending') {
      allShayaris.sort((a, b) => b.likes - a.likes);
    }
    
    // Apply pagination
    const start = (page - 1) * CONFIG.SHAYARI_PER_PAGE;
    const end = start + CONFIG.SHAYARI_PER_PAGE;
    const paginatedShayaris = allShayaris.slice(start, end);
    
    // Prepare response
    const responseData = {
      shayaris: paginatedShayaris,
      totalLikes: totalLikes,
      pagination: {
        page: parseInt(page),
        perPage: CONFIG.SHAYARI_PER_PAGE,
        total: allShayaris.length,
        hasMore: end < allShayaris.length
      }
    };
    
    // Cache for 2 minutes
    cache.put(cacheKey, JSON.stringify(responseData), 120);
    
    return {
      success: true,
      message: 'Shayari loaded successfully',
      data: paginatedShayaris,
      totalLikes: totalLikes,
      pagination: responseData.pagination
    };
    
  } catch (error) {
    console.error('getAllShayari error:', error);
    return { 
      success: false, 
      message: 'Failed to load shayari',
      data: [] 
    };
  }
}

// 👤 GET MY SHAYARI
function getMyShayari(username, page = 1, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to view your shayari' };
    }
    
    if (userResult.data.username.toLowerCase() !== username.toLowerCase()) {
      return { success: false, message: 'Unauthorized access' };
    }
    
    const cache = getCache();
    const cacheKey = `my_shayari_${username}_page_${page}`;
    
    // Try cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        return { 
          success: true, 
          message: 'My shayari loaded from cache',
          data: data 
        };
      } catch (e) {
        cache.remove(cacheKey);
      }
    }
    
    // Get from spreadsheet
    const ss = getSpreadsheet();
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    
    if (!shayariSheet) {
      return { success: true, message: 'No shayari found', data: [] };
    }
    
    const data = shayariSheet.getDataRange().getValues();
    
    const myShayaris = [];
    
    for (let i = data.length - 1; i >= 1; i--) {
      // Skip if not user's shayari or deleted
      if (data[i][1] && data[i][1].toLowerCase() === username.toLowerCase() && data[i][8] !== 'TRUE') {
        const shayari = {
          id: data[i][0],
          username: data[i][1],
          text: data[i][2],
          category: data[i][3] || 'other',
          likes: parseInt(data[i][4]) || 0,
          comments: parseInt(data[i][5]) || 0,
          saves: parseInt(data[i][6]) || 0,
          views: parseInt(data[i][7]) || 0,
          createdAt: data[i][9],
          updatedAt: data[i][10],
          date: formatDate(data[i][9]),
          time: formatTime(data[i][9])
        };
        
        myShayaris.push(shayari);
      }
    }
    
    // Apply pagination
    const start = (page - 1) * CONFIG.SHAYARI_PER_PAGE;
    const end = start + CONFIG.SHAYARI_PER_PAGE;
    const paginatedShayaris = myShayaris.slice(start, end);
    
    // Cache for 1 minute
    cache.put(cacheKey, JSON.stringify(paginatedShayaris), 60);
    
    return {
      success: true,
      message: 'My shayari loaded',
      data: paginatedShayaris,
      pagination: {
        page: parseInt(page),
        perPage: CONFIG.SHAYARI_PER_PAGE,
        total: myShayaris.length,
        hasMore: end < myShayaris.length
      }
    };
    
  } catch (error) {
    console.error('getMyShayari error:', error);
    return { 
      success: false, 
      message: 'Failed to load your shayari',
      data: [] 
    };
  }
}

// ❤️ LIKE SHAYARI
function likeShayari(shayariId, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to like shayari' };
    }
    
    const username = userResult.data.username;
    
    // Get shayari details
    const ss = getSpreadsheet();
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    
    if (!shayariSheet) {
      return { success: false, message: 'Shayari not found' };
    }
    
    const data = shayariSheet.getDataRange().getValues();
    let shayariRow = -1;
    let currentLikes = 0;
    let shayariUsername = '';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shayariId && data[i][8] !== 'TRUE') {
        shayariRow = i;
        currentLikes = parseInt(data[i][4]) || 0;
        shayariUsername = data[i][1];
        break;
      }
    }
    
    if (shayariRow === -1) {
      return { success: false, message: 'Shayari not found' };
    }
    
    // Check if already liked
    const likesSheet = ss.getSheetByName(CONFIG.LIKES_SHEET);
    if (!likesSheet) {
      return { success: false, message: 'System error' };
    }
    
    const likesData = likesSheet.getDataRange().getValues();
    let alreadyLiked = false;
    let likeRow = -1;
    
    for (let i = 1; i < likesData.length; i++) {
      if (likesData[i][0] && likesData[i][0].toLowerCase() === username.toLowerCase() &&
          likesData[i][1] === shayariId) {
        alreadyLiked = true;
        likeRow = i;
        break;
      }
    }
    
    if (alreadyLiked) {
      // Unlike
      likesSheet.deleteRow(likeRow + 1);
      currentLikes = Math.max(0, currentLikes - 1);
      
      // Update shayari likes count
      shayariSheet.getRange(shayariRow + 1, 5).setValue(currentLikes);
      
      // Clear relevant caches
      clearCachePattern('*shayari*');
      clearCachePattern('user_shayari_' + shayariUsername + '_*');
      
      return { 
        success: true, 
        message: 'Shayari unliked',
        data: { likes: currentLikes, liked: false }
      };
    } else {
      // Like
      likesSheet.appendRow([
        username,
        shayariId,
        new Date().toISOString()
      ]);
      
      currentLikes += 1;
      
      // Update shayari likes count
      shayariSheet.getRange(shayariRow + 1, 5).setValue(currentLikes);
      
      // Clear relevant caches
      clearCachePattern('*shayari*');
      clearCachePattern('user_shayari_' + shayariUsername + '_*');
      
      return { 
        success: true, 
        message: 'Shayari liked! ❤️',
        data: { likes: currentLikes, liked: true }
      };
    }
    
  } catch (error) {
    console.error('likeShayari error:', error);
    return { 
      success: false, 
      message: 'Failed to like shayari: ' + error.toString() 
    };
  }
}

// 💾 SAVE SHAYARI
function saveShayari(shayariId, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to save shayari' };
    }
    
    const username = userResult.data.username;
    
    // Check if shayari exists
    const ss = getSpreadsheet();
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    
    if (!shayariSheet) {
      return { success: false, message: 'Shayari not found' };
    }
    
    const data = shayariSheet.getDataRange().getValues();
    let shayariExists = false;
    let shayariUsername = '';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shayariId && data[i][8] !== 'TRUE') {
        shayariExists = true;
        shayariUsername = data[i][1];
        break;
      }
    }
    
    if (!shayariExists) {
      return { success: false, message: 'Shayari not found' };
    }
    
    // Check if already saved
    const savesSheet = ss.getSheetByName(CONFIG.SAVES_SHEET);
    if (!savesSheet) {
      return { success: false, message: 'System error' };
    }
    
    const savesData = savesSheet.getDataRange().getValues();
    let alreadySaved = false;
    let saveRow = -1;
    
    for (let i = 1; i < savesData.length; i++) {
      if (savesData[i][0] && savesData[i][0].toLowerCase() === username.toLowerCase() &&
          savesData[i][1] === shayariId) {
        alreadySaved = true;
        saveRow = i;
        break;
      }
    }
    
    if (alreadySaved) {
      // Unsave
      savesSheet.deleteRow(saveRow + 1);
      
      // Update shayari saves count
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === shayariId) {
          const currentSaves = Math.max(0, (parseInt(data[i][6]) || 0) - 1);
          shayariSheet.getRange(i + 1, 7).setValue(currentSaves);
          break;
        }
      }
      
      // Clear relevant caches
      clearCachePattern('*shayari*');
      clearCachePattern('user_shayari_' + shayariUsername + '_*');
      
      return { 
        success: true, 
        message: 'Shayari unsaved',
        data: { saved: false }
      };
    } else {
      // Save
      savesSheet.appendRow([
        username,
        shayariId,
        new Date().toISOString()
      ]);
      
      // Update shayari saves count
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === shayariId) {
          const currentSaves = (parseInt(data[i][6]) || 0) + 1;
          shayariSheet.getRange(i + 1, 7).setValue(currentSaves);
          break;
        }
      }
      
      // Clear relevant caches
      clearCachePattern('*shayari*');
      clearCachePattern('user_shayari_' + shayariUsername + '_*');
      
      return { 
        success: true, 
        message: 'Shayari saved! 💾',
        data: { saved: true }
      };
    }
    
  } catch (error) {
    console.error('saveShayari error:', error);
    return { 
      success: false, 
      message: 'Failed to save shayari: ' + error.toString() 
    };
  }
}

// 🗑️ DELETE SHAYARI (Soft Delete)
function deleteShayari(shayariId, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to delete shayari' };
    }
    
    const username = userResult.data.username;
    
    // Find shayari
    const ss = getSpreadsheet();
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    
    if (!shayariSheet) {
      return { success: false, message: 'Shayari not found' };
    }
    
    const data = shayariSheet.getDataRange().getValues();
    let shayariRow = -1;
    let shayariUsername = '';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shayariId) {
        shayariRow = i;
        shayariUsername = data[i][1];
        break;
      }
    }
    
    if (shayariRow === -1) {
      return { success: false, message: 'Shayari not found' };
    }
    
    // Check ownership
    if (shayariUsername.toLowerCase() !== username.toLowerCase()) {
      return { success: false, message: 'You can only delete your own shayari' };
    }
    
    // Soft delete (mark as deleted)
    shayariSheet.getRange(shayariRow + 1, 9).setValue('TRUE');
    shayariSheet.getRange(shayariRow + 1, 11).setValue(new Date().toISOString());
    
    // Clear relevant caches
    clearCachePattern('*shayari*');
    clearCachePattern('user_shayari_' + username + '_*');
    
    return { 
      success: true, 
      message: 'Shayari deleted successfully'
    };
    
  } catch (error) {
    console.error('deleteShayari error:', error);
    return { 
      success: false, 
      message: 'Failed to delete shayari: ' + error.toString() 
    };
  }
}

// 🚩 REPORT SHAYARI
function reportShayari(shayariId, reason, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to report shayari' };
    }
    
    const username = userResult.data.username;
    
    // Check if shayari exists
    const ss = getSpreadsheet();
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    
    if (!shayariSheet) {
      return { success: false, message: 'Shayari not found' };
    }
    
    const data = shayariSheet.getDataRange().getValues();
    let shayariExists = false;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shayariId && data[i][8] !== 'TRUE') {
        shayariExists = true;
        break;
      }
    }
    
    if (!shayariExists) {
      return { success: false, message: 'Shayari not found' };
    }
    
    // Check if already reported
    const reportsSheet = ss.getSheetByName(CONFIG.REPORTS_SHEET);
    if (!reportsSheet) {
      return { success: false, message: 'System error' };
    }
    
    const reportsData = reportsSheet.getDataRange().getValues();
    for (let i = 1; i < reportsData.length; i++) {
      if (reportsData[i][1] === shayariId && 
          reportsData[i][2].toLowerCase() === username.toLowerCase()) {
        return { success: false, message: 'You have already reported this shayari' };
      }
    }
    
    // Create report
    const reportId = generateReportId();
    reportsSheet.appendRow([
      reportId,
      shayariId,
      username,
      reason,
      'pending',
      new Date().toISOString()
    ]);
    
    return { 
      success: true, 
      message: 'Shayari reported successfully. Our team will review it shortly.'
    };
    
  } catch (error) {
    console.error('reportShayari error:', error);
    return { 
      success: false, 
      message: 'Failed to report shayari: ' + error.toString() 
    };
  }
}

// 👤 GET PROFILE
function getProfile(username, sessionToken = null) {
  try {
    // Get requesting user
    const requesterResult = sessionToken ? getCurrentUser(sessionToken) : { success: false };
    const requesterUsername = requesterResult.success ? requesterResult.data.username : null;
    
    // Get profile user
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'User not found' };
    }
    
    const data = userSheet.getDataRange().getValues();
    let profileUser = null;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === username.toLowerCase()) {
        profileUser = {
          username: data[i][0],
          email: data[i][1],
          createdAt: data[i][4],
          lastLogin: data[i][5],
          isPremium: data[i][6] === 'TRUE',
          premiumUntil: data[i][7],
          profilePic: data[i][8],
          bio: data[i][9],
          privacy: data[i][10] || 'public'
        };
        break;
      }
    }
    
    if (!profileUser) {
      return { success: false, message: 'User not found' };
    }
    
    // Check privacy
    if (profileUser.privacy === 'private' && requesterUsername !== username) {
      // Check if requester is following
      const followsSheet = ss.getSheetByName(CONFIG.FOLLOWS_SHEET);
      let isFollowing = false;
      
      if (followsSheet && requesterUsername) {
        const followsData = followsSheet.getDataRange().getValues();
        for (let i = 1; i < followsData.length; i++) {
          if (followsData[i][0] && followsData[i][0].toLowerCase() === requesterUsername.toLowerCase() &&
              followsData[i][1] && followsData[i][1].toLowerCase() === username.toLowerCase()) {
            isFollowing = true;
            break;
          }
        }
      }
      
      if (!isFollowing) {
        return { 
          success: false, 
          message: 'This profile is private. Follow the user to view their profile.' 
        };
      }
    }
    
    // Get statistics
    let shayariCount = 0;
    let likesCount = 0;
    let followersCount = 0;
    let followingCount = 0;
    
    // Shayari count
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    if (shayariSheet) {
      const shayariData = shayariSheet.getDataRange().getValues();
      for (let i = 1; i < shayariData.length; i++) {
        if (shayariData[i][1] && shayariData[i][1].toLowerCase() === username.toLowerCase() &&
            shayariData[i][8] !== 'TRUE') {
          shayariCount++;
          likesCount += parseInt(shayariData[i][4]) || 0;
        }
      }
    }
    
    // Followers count
    const followsSheet = ss.getSheetByName(CONFIG.FOLLOWS_SHEET);
    if (followsSheet) {
      const followsData = followsSheet.getDataRange().getValues();
      for (let i = 1; i < followsData.length; i++) {
        if (followsData[i][1] && followsData[i][1].toLowerCase() === username.toLowerCase()) {
          followersCount++;
        }
        if (followsData[i][0] && followsData[i][0].toLowerCase() === username.toLowerCase()) {
          followingCount++;
        }
      }
    }
    
    // Check if requester is following
    let isFollowing = false;
    if (requesterUsername && followsSheet) {
      const followsData = followsSheet.getDataRange().getValues();
      for (let i = 1; i < followsData.length; i++) {
        if (followsData[i][0] && followsData[i][0].toLowerCase() === requesterUsername.toLowerCase() &&
            followsData[i][1] && followsData[i][1].toLowerCase() === username.toLowerCase()) {
          isFollowing = true;
          break;
        }
      }
    }
    
    // Check if requester is blocked
    let isBlocked = false;
    if (requesterUsername) {
      const blocksSheet = ss.getSheetByName(CONFIG.BLOCKS_SHEET);
      if (blocksSheet) {
        const blocksData = blocksSheet.getDataRange().getValues();
        for (let i = 1; i < blocksData.length; i++) {
          if (blocksData[i][0] && blocksData[i][0].toLowerCase() === username.toLowerCase() &&
              blocksData[i][1] && blocksData[i][1].toLowerCase() === requesterUsername.toLowerCase()) {
            isBlocked = true;
            break;
          }
        }
      }
    }
    
    return {
      success: true,
      message: 'Profile loaded successfully',
      data: {
        ...profileUser,
        shayariCount: shayariCount,
        likesCount: likesCount,
        followers: followersCount,
        following: followingCount,
        isFollowing: isFollowing,
        isBlocked: isBlocked
      }
    };
    
  } catch (error) {
    console.error('getProfile error:', error);
    return { 
      success: false, 
      message: 'Failed to load profile: ' + error.toString() 
    };
  }
}

// 🤝 FOLLOW USER
function followUser(usernameToFollow, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to follow users' };
    }
    
    const username = userResult.data.username;
    
    if (username.toLowerCase() === usernameToFollow.toLowerCase()) {
      return { success: false, message: 'You cannot follow yourself' };
    }
    
    // Check if user to follow exists
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'User not found' };
    }
    
    const data = userSheet.getDataRange().getValues();
    let userExists = false;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === usernameToFollow.toLowerCase()) {
        userExists = true;
        break;
      }
    }
    
    if (!userExists) {
      return { success: false, message: 'User not found' };
    }
    
    // Check if already following
    const followsSheet = ss.getSheetByName(CONFIG.FOLLOWS_SHEET);
    if (!followsSheet) {
      return { success: false, message: 'System error' };
    }
    
    const followsData = followsSheet.getDataRange().getValues();
    for (let i = 1; i < followsData.length; i++) {
      if (followsData[i][0] && followsData[i][0].toLowerCase() === username.toLowerCase() &&
          followsData[i][1] && followsData[i][1].toLowerCase() === usernameToFollow.toLowerCase()) {
        return { success: false, message: 'You are already following this user' };
      }
    }
    
    // Check if blocked
    const blocksSheet = ss.getSheetByName(CONFIG.BLOCKS_SHEET);
    if (blocksSheet) {
      const blocksData = blocksSheet.getDataRange().getValues();
      for (let i = 1; i < blocksData.length; i++) {
        if (blocksData[i][0] && blocksData[i][0].toLowerCase() === usernameToFollow.toLowerCase() &&
            blocksData[i][1] && blocksData[i][1].toLowerCase() === username.toLowerCase()) {
          return { success: false, message: 'You cannot follow this user' };
        }
      }
    }
    
    // Create follow relationship
    followsSheet.appendRow([
      username,
      usernameToFollow,
      new Date().toISOString()
    ]);
    
    // Clear relevant caches
    clearCachePattern('profile_' + usernameToFollow + '_*');
    clearCachePattern('profile_' + username + '_*');
    
    return { 
      success: true, 
      message: `You are now following ${usernameToFollow}`
    };
    
  } catch (error) {
    console.error('followUser error:', error);
    return { 
      success: false, 
      message: 'Failed to follow user: ' + error.toString() 
    };
  }
}

// 🚫 UNFOLLOW USER
function unfollowUser(usernameToUnfollow, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to unfollow users' };
    }
    
    const username = userResult.data.username;
    
    // Find and remove follow relationship
    const ss = getSpreadsheet();
    const followsSheet = ss.getSheetByName(CONFIG.FOLLOWS_SHEET);
    
    if (!followsSheet) {
      return { success: false, message: 'System error' };
    }
    
    const data = followsSheet.getDataRange().getValues();
    let followRow = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === username.toLowerCase() &&
          data[i][1] && data[i][1].toLowerCase() === usernameToUnfollow.toLowerCase()) {
        followRow = i;
        break;
      }
    }
    
    if (followRow === -1) {
      return { success: false, message: 'You are not following this user' };
    }
    
    // Remove follow
    followsSheet.deleteRow(followRow + 1);
    
    // Clear relevant caches
    clearCachePattern('profile_' + usernameToUnfollow + '_*');
    clearCachePattern('profile_' + username + '_*');
    
    return { 
      success: true, 
      message: `You have unfollowed ${usernameToUnfollow}`
    };
    
  } catch (error) {
    console.error('unfollowUser error:', error);
    return { 
      success: false, 
      message: 'Failed to unfollow user: ' + error.toString() 
    };
  }
}

// ⛔ BLOCK USER
function blockUser(usernameToBlock, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to block users' };
    }
    
    const username = userResult.data.username;
    
    if (username.toLowerCase() === usernameToBlock.toLowerCase()) {
      return { success: false, message: 'You cannot block yourself' };
    }
    
    // Check if user to block exists
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'User not found' };
    }
    
    const data = userSheet.getDataRange().getValues();
    let userExists = false;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === usernameToBlock.toLowerCase()) {
        userExists = true;
        break;
      }
    }
    
    if (!userExists) {
      return { success: false, message: 'User not found' };
    }
    
    // Check if already blocked
    const blocksSheet = ss.getSheetByName(CONFIG.BLOCKS_SHEET);
    if (!blocksSheet) {
      return { success: false, message: 'System error' };
    }
    
    const blocksData = blocksSheet.getDataRange().getValues();
    for (let i = 1; i < blocksData.length; i++) {
      if (blocksData[i][0] && blocksData[i][0].toLowerCase() === username.toLowerCase() &&
          blocksData[i][1] && blocksData[i][1].toLowerCase() === usernameToBlock.toLowerCase()) {
        return { success: false, message: 'You have already blocked this user' };
      }
    }
    
    // Create block relationship
    blocksSheet.appendRow([
      username,
      usernameToBlock,
      new Date().toISOString()
    ]);
    
    // Remove follow relationship if exists
    const followsSheet = ss.getSheetByName(CONFIG.FOLLOWS_SHEET);
    if (followsSheet) {
      const followsData = followsSheet.getDataRange().getValues();
      for (let i = followsData.length - 1; i >= 1; i--) {
        if ((followsData[i][0] && followsData[i][0].toLowerCase() === username.toLowerCase() &&
             followsData[i][1] && followsData[i][1].toLowerCase() === usernameToBlock.toLowerCase()) ||
            (followsData[i][0] && followsData[i][0].toLowerCase() === usernameToBlock.toLowerCase() &&
             followsData[i][1] && followsData[i][1].toLowerCase() === username.toLowerCase())) {
          followsSheet.deleteRow(i + 1);
        }
      }
    }
    
    // Clear relevant caches
    clearCachePattern('profile_' + usernameToBlock + '_*');
    clearCachePattern('profile_' + username + '_*');
    clearCachePattern('*shayari*');
    
    return { 
      success: true, 
      message: `You have blocked ${usernameToBlock}`
    };
    
  } catch (error) {
    console.error('blockUser error:', error);
    return { 
      success: false, 
      message: 'Failed to block user: ' + error.toString() 
    };
  }
}

// ✅ UNBLOCK USER
function unblockUser(usernameToUnblock, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to unblock users' };
    }
    
    const username = userResult.data.username;
    
    // Find and remove block relationship
    const ss = getSpreadsheet();
    const blocksSheet = ss.getSheetByName(CONFIG.BLOCKS_SHEET);
    
    if (!blocksSheet) {
      return { success: false, message: 'System error' };
    }
    
    const data = blocksSheet.getDataRange().getValues();
    let blockRow = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === username.toLowerCase() &&
          data[i][1] && data[i][1].toLowerCase() === usernameToUnblock.toLowerCase()) {
        blockRow = i;
        break;
      }
    }
    
    if (blockRow === -1) {
      return { success: false, message: 'You have not blocked this user' };
    }
    
    // Remove block
    blocksSheet.deleteRow(blockRow + 1);
    
    // Clear relevant caches
    clearCachePattern('profile_' + usernameToUnblock + '_*');
    clearCachePattern('profile_' + username + '_*');
    clearCachePattern('*shayari*');
    
    return { 
      success: true, 
      message: `You have unblocked ${usernameToUnblock}`
    };
    
  } catch (error) {
    console.error('unblockUser error:', error);
    return { 
      success: false, 
      message: 'Failed to unblock user: ' + error.toString() 
    };
  }
}

// 🔧 CHANGE USERNAME
function changeUsername(newUsername, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to change username' };
    }
    
    const oldUsername = userResult.data.username;
    newUsername = newUsername.toLowerCase().trim();
    
    if (!newUsername) {
      return { success: false, message: 'New username required' };
    }
    
    if (newUsername.length < 3) {
      return { success: false, message: 'Username must be at least 3 characters' };
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      return { success: false, message: 'Username can only contain letters, numbers and underscore' };
    }
    
    if (newUsername.toLowerCase() === oldUsername.toLowerCase()) {
      return { success: false, message: 'New username must be different' };
    }
    
    // Check if username is already taken
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'System error' };
    }
    
    const data = userSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === newUsername.toLowerCase()) {
        return { success: false, message: 'Username already taken' };
      }
    }
    
    // Update username in users sheet
    let userRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === oldUsername.toLowerCase()) {
        userRow = i;
        userSheet.getRange(i + 1, 1).setValue(newUsername);
        break;
      }
    }
    
    if (userRow === -1) {
      return { success: false, message: 'User not found' };
    }
    
    // Update username in shayari sheet
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    if (shayariSheet) {
      const shayariData = shayariSheet.getDataRange().getValues();
      for (let i = 1; i < shayariData.length; i++) {
        if (shayariData[i][1] && shayariData[i][1].toLowerCase() === oldUsername.toLowerCase()) {
          shayariSheet.getRange(i + 1, 2).setValue(newUsername);
        }
      }
    }
    
    // Update username in follows sheet
    const followsSheet = ss.getSheetByName(CONFIG.FOLLOWS_SHEET);
    if (followsSheet) {
      const followsData = followsSheet.getDataRange().getValues();
      for (let i = 1; i < followsData.length; i++) {
        if (followsData[i][0] && followsData[i][0].toLowerCase() === oldUsername.toLowerCase()) {
          followsSheet.getRange(i + 1, 1).setValue(newUsername);
        }
        if (followsData[i][1] && followsData[i][1].toLowerCase() === oldUsername.toLowerCase()) {
          followsSheet.getRange(i + 1, 2).setValue(newUsername);
        }
      }
    }
    
    // Update username in likes sheet
    const likesSheet = ss.getSheetByName(CONFIG.LIKES_SHEET);
    if (likesSheet) {
      const likesData = likesSheet.getDataRange().getValues();
      for (let i = 1; i < likesData.length; i++) {
        if (likesData[i][0] && likesData[i][0].toLowerCase() === oldUsername.toLowerCase()) {
          likesSheet.getRange(i + 1, 1).setValue(newUsername);
        }
      }
    }
    
    // Update username in saves sheet
    const savesSheet = ss.getSheetByName(CONFIG.SAVES_SHEET);
    if (savesSheet) {
      const savesData = savesSheet.getDataRange().getValues();
      for (let i = 1; i < savesData.length; i++) {
        if (savesData[i][0] && savesData[i][0].toLowerCase() === oldUsername.toLowerCase()) {
          savesSheet.getRange(i + 1, 1).setValue(newUsername);
        }
      }
    }
    
    // Update username in comments sheet
    const commentsSheet = ss.getSheetByName(CONFIG.COMMENTS_SHEET);
    if (commentsSheet) {
      const commentsData = commentsSheet.getDataRange().getValues();
      for (let i = 1; i < commentsData.length; i++) {
        if (commentsData[i][2] && commentsData[i][2].toLowerCase() === oldUsername.toLowerCase()) {
          commentsSheet.getRange(i + 1, 3).setValue(newUsername);
        }
      }
    }
    
    // Update username in reports sheet
    const reportsSheet = ss.getSheetByName(CONFIG.REPORTS_SHEET);
    if (reportsSheet) {
      const reportsData = reportsSheet.getDataRange().getValues();
      for (let i = 1; i < reportsData.length; i++) {
        if (reportsData[i][2] && reportsData[i][2].toLowerCase() === oldUsername.toLowerCase()) {
          reportsSheet.getRange(i + 1, 3).setValue(newUsername);
        }
      }
    }
    
    // Update username in blocks sheet
    const blocksSheet = ss.getSheetByName(CONFIG.BLOCKS_SHEET);
    if (blocksSheet) {
      const blocksData = blocksSheet.getDataRange().getValues();
      for (let i = 1; i < blocksData.length; i++) {
        if (blocksData[i][0] && blocksData[i][0].toLowerCase() === oldUsername.toLowerCase()) {
          blocksSheet.getRange(i + 1, 1).setValue(newUsername);
        }
        if (blocksData[i][1] && blocksData[i][1].toLowerCase() === oldUsername.toLowerCase()) {
          blocksSheet.getRange(i + 1, 2).setValue(newUsername);
        }
      }
    }
    
    // Update session store
    const store = getUserStore();
    const cache = getCache();
    
    // Get session token
    const sessionKey = 'user_session_' + oldUsername;
    const sessionTokenValue = store.getProperty(sessionKey);
    
    if (sessionTokenValue) {
      // Update session references
      store.deleteProperty(sessionKey);
      store.deleteProperty('session_' + sessionTokenValue);
      cache.remove('session_' + sessionTokenValue);
      
      // Create new session
      const newSessionToken = generateSessionToken();
      store.setProperty('session_' + newSessionToken, newUsername);
      store.setProperty('user_session_' + newUsername, newSessionToken);
      
      // Update user data in cache
      const userData = {
        ...userResult.data,
        username: newUsername,
        sessionToken: newSessionToken
      };
      
      cache.put('session_' + newSessionToken, JSON.stringify(userData), CONFIG.SESSION_TTL);
    }
    
    // Clear all caches
    clearAllCache();
    
    return { 
      success: true, 
      message: 'Username changed successfully',
      data: {
        username: newUsername,
        sessionToken: sessionTokenValue ? null : userResult.data.sessionToken
      }
    };
    
  } catch (error) {
    console.error('changeUsername error:', error);
    return { 
      success: false, 
      message: 'Failed to change username: ' + error.toString() 
    };
  }
}

// 🔑 CHANGE PASSWORD
function changePassword(currentPassword, newPassword, sessionToken) {
  try {
    const userResult = getCurrentUser(sessionToken);
    if (!userResult.success) {
      return { success: false, message: 'Please login to change password' };
    }
    
    const username = userResult.data.username;
    
    if (!currentPassword || !newPassword) {
      return { success: false, message: 'Both passwords are required' };
    }
    
    if (newPassword.length < 6) {
      return { success: false, message: 'New password must be at least 6 characters' };
    }
    
    // Verify current password
    const ss = getSpreadsheet();
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    
    if (!userSheet) {
      return { success: false, message: 'System error' };
    }
    
    const data = userSheet.getDataRange().getValues();
    let userRow = -1;
    let currentHash = '';
    let currentSalt = '';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toLowerCase() === username.toLowerCase()) {
        userRow = i;
        currentHash = data[i][2];
        currentSalt = data[i][3];
        break;
      }
    }
    
    if (userRow === -1) {
      return { success: false, message: 'User not found' };
    }
    
    // Verify current password
    const hashResult = hashPassword(currentPassword, currentSalt);
    if (hashResult.hash !== currentHash) {
      return { success: false, message: 'Current password is incorrect' };
    }
    
    // Generate new hash
    const newHashResult = hashPassword(newPassword);
    
    // Update password
    userSheet.getRange(userRow + 1, 3).setValue(newHashResult.hash);
    userSheet.getRange(userRow + 1, 4).setValue(newHashResult.salt);
    
    return { 
      success: true, 
      message: 'Password changed successfully'
    };
    
  } catch (error) {
    console.error('changePassword error:', error);
    return { 
      success: false, 
      message: 'Failed to change password: ' + error.toString() 
    };
  }
}

// 📊 GET SYSTEM STATS
function getSystemStats() {
  try {
    const cache = getCache();
    const cacheKey = 'system_stats';
    
    // Try cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        return { 
          success: true, 
          message: 'Stats loaded from cache',
          data: JSON.parse(cached)
        };
      } catch (e) {
        cache.remove(cacheKey);
      }
    }
    
    const ss = getSpreadsheet();
    const stats = {
      totalUsers: 0,
      totalShayari: 0,
      totalLikes: 0,
      totalComments: 0,
      totalSaves: 0,
      trendingShayari: [],
      topShayars: []
    };
    
    // Total users
    const userSheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    if (userSheet) {
      const data = userSheet.getDataRange().getValues();
      stats.totalUsers = Math.max(0, data.length - 1);
    }
    
    // Shayari stats
    const shayariSheet = ss.getSheetByName(CONFIG.SHAYARI_SHEET);
    if (shayariSheet) {
      const data = shayariSheet.getDataRange().getValues();
      let shayariCount = 0;
      let totalLikes = 0;
      let totalComments = 0;
      let totalSaves = 0;
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][8] !== 'TRUE') {
          shayariCount++;
          totalLikes += parseInt(data[i][4]) || 0;
          totalComments += parseInt(data[i][5]) || 0;
          totalSaves += parseInt(data[i][6]) || 0;
        }
      }
      
      stats.totalShayari = shayariCount;
      stats.totalLikes = totalLikes;
      stats.totalComments = totalComments;
      stats.totalSaves = totalSaves;
      
      // Get trending shayari (top 5 by likes)
      const trending = [];
      for (let i = 1; i < Math.min(data.length, 50); i++) {
        if (data[i][8] !== 'TRUE') {
          trending.push({
            id: data[i][0],
            username: data[i][1],
            text: data[i][2],
            likes: parseInt(data[i][4]) || 0,
            createdAt: data[i][9]
          });
        }
      }
      
      trending.sort((a, b) => b.likes - a.likes);
      stats.trendingShayari = trending.slice(0, 5);
    }
    
    // Get top shayars (by total likes)
    if (shayariSheet && userSheet) {
      const shayariData = shayariSheet.getDataRange().getValues();
      const userData = userSheet.getDataRange().getValues();
      
      const shayarStats = {};
      
      for (let i = 1; i < shayariData.length; i++) {
        if (shayariData[i][8] !== 'TRUE') {
          const username = shayariData[i][1];
          const likes = parseInt(shayariData[i][4]) || 0;
          
          if (!shayarStats[username]) {
            shayarStats[username] = {
              username: username,
              totalLikes: 0,
              shayariCount: 0
            };
          }
          
          shayarStats[username].totalLikes += likes;
          shayarStats[username].shayariCount++;
        }
      }
      
      const topShayars = Object.values(shayarStats);
      topShayars.sort((a, b) => b.totalLikes - a.totalLikes);
      stats.topShayars = topShayars.slice(0, 10);
    }
    
    // Cache for 5 minutes
    cache.put(cacheKey, JSON.stringify(stats), 300);
    
    return {
      success: true,
      message: 'System stats loaded',
      data: stats
    };
    
  } catch (error) {
    console.error('getSystemStats error:', error);
    return {
      success: false,
      message: 'Failed to load system stats',
      data: {}
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// 📅 FORMAT DATE
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) return 'अभी अभी';
    if (diffMin < 60) return `${diffMin} मिनट पहले`;
    if (diffHour < 24) return `${diffHour} घंटे पहले`;
    if (diffDay < 7) return `${diffDay} दिन पहले`;
    
    return date.toLocaleDateString('hi-IN');
  } catch (e) {
    return dateString;
  }
}

// ⏰ FORMAT TIME
function formatTime(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

// 🗑️ CLEAR CACHE PATTERN
function clearCachePattern(pattern) {
  try {
    const cache = getCache();
    // Note: Apps Script CacheService doesn't support pattern deletion
    // We'll just clear all cache for simplicity
    cache.removeAll();
  } catch (e) {
    // Ignore cache errors
  }
}

// 🗑️ CLEAR ALL CACHE
function clearAllCache() {
  try {
    const cache = getCache();
    cache.removeAll();
    return { success: true, message: 'Cache cleared' };
  } catch (error) {
    return { success: false, message: 'Failed to clear cache' };
  }
}

// 📦 INITIALIZE SHEETS
function initializeSheets() {
  try {
    const ss = getSpreadsheet();
    
    // Create all sheets with headers
    Object.keys(SHEET_HEADERS).forEach(sheetName => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(SHEET_HEADERS[sheetName]);
        
        // Format header
        const headerRange = sheet.getRange(1, 1, 1, SHEET_HEADERS[sheetName].length);
        headerRange.setBackground('#8A2BE2');
        headerRange.setFontColor('white');
        headerRange.setFontWeight('bold');
        headerRange.setHorizontalAlignment('center');
      }
    });
    
    // Store spreadsheet ID in script properties
    const scriptProperties = PropertiesService.getScriptProperties();
    scriptProperties.setProperty('SPREADSHEET_ID', ss.getId());
    
    return { 
      success: true, 
      message: 'All sheets initialized successfully',
      spreadsheetId: ss.getId(),
      webAppUrl: ScriptApp.getService().getUrl()
    };
    
  } catch (error) {
    console.error('initializeSheets error:', error);
    return { 
      success: false, 
      message: 'Failed to initialize sheets: ' + error.toString() 
    };
  }
}

// 🌐 WEB APP DEPLOYMENT
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('नूर.इन - शायरी का स्वर्ग')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const action = e.parameter.action;
    const postData = JSON.parse(e.postData.contents);
    
    let result = { success: false, message: 'Invalid action' };
    
    // Route to appropriate function
    switch (action) {
      case 'signup':
        result = signupUser(postData.username, postData.email, postData.password);
        break;
      case 'login':
        result = loginUser(postData.email, postData.password);
        break;
      case 'logout':
        result = logoutUser(postData.sessionToken);
        break;
      case 'postShayari':
        result = postShayari(postData.text, postData.author, postData.category, postData.sessionToken);
        break;
      case 'getAllShayari':
        result = getAllShayari(postData.page || 1, postData.filter || 'all', postData.search || '', postData.sessionToken || null);
        break;
      case 'getMyShayari':
        result = getMyShayari(postData.username, postData.page || 1, postData.sessionToken);
        break;
      case 'likeShayari':
        result = likeShayari(postData.shayariId, postData.sessionToken);
        break;
      case 'saveShayari':
        result = saveShayari(postData.shayariId, postData.sessionToken);
        break;
      case 'deleteShayari':
        result = deleteShayari(postData.shayariId, postData.sessionToken);
        break;
      case 'reportShayari':
        result = reportShayari(postData.shayariId, postData.reason, postData.sessionToken);
        break;
      case 'getProfile':
        result = getProfile(postData.username, postData.sessionToken || null);
        break;
      case 'followUser':
        result = followUser(postData.username, postData.sessionToken);
        break;
      case 'unfollowUser':
        result = unfollowUser(postData.username, postData.sessionToken);
        break;
      case 'blockUser':
        result = blockUser(postData.username, postData.sessionToken);
        break;
      case 'unblockUser':
        result = unblockUser(postData.username, postData.sessionToken);
        break;
      case 'changeUsername':
        result = changeUsername(postData.newUsername, postData.sessionToken);
        break;
      case 'changePassword':
        result = changePassword(postData.currentPassword, postData.newPassword, postData.sessionToken);
        break;
      case 'getSystemStats':
        result = getSystemStats();
        break;
      case 'initializeSheets':
        result = initializeSheets();
        break;
      case 'clearAllCache':
        result = clearAllCache();
        break;
      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }
    
    // Return JSON response
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    console.error('doPost error:', error);
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: false, 
        message: 'Server error: ' + error.toString() 
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}