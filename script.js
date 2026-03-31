// script.js:
// 1. renders chat messages and quick reply buttons
// 2. tracks chatbot state (what step user is on)
// 3. uses rule-based troubleshooting for common issues
// 4. falls back to AI only when the rule-based flow is not enough
// 5. protects against prompt injection & off-topic misuse
// 6. can generate a support email draft to IT when escalation is needed
//
// Main idea:
// - cheap & predictable issues are handled with fixed logic
// - more complex issues use AI as a fallback
// - added security measures for possible prompt injection

const chatbox = document.getElementById('chatbox');
const quickReplies = document.getElementById('quickReplies');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

// Input and AI limits 
const MAX_USER_MESSAGE_LENGTH = 800;
const MAX_AI_ATTEMPTS_PER_ISSUE = 15;
const MAX_AI_CONTEXT_LENGTH = 3000;
const MAX_AI_STEP_HISTORY = 10;
const MAX_INPUT_LINES = 20;
const IT_SUPPORT_EMAIL = 'itsupport@company.com';

// UI text
const TEXT = {
  mainMenu:
    "Hi, I'm your IT Helpdesk Assistant. What can I help you with today?\n\n1. Reset password\n2. Wi-Fi not working\n3. Slow computer\n4. Other issue",
  chooseOption: 'Please choose one of the options below.',
  yesNoGuide: 'Please answer Yes or No so I can guide you to the next step.',
  yesNoButtons: 'Please use the Yes or No buttons below.',
  returnToMenu: 'Would you like to return to the main menu?',
  closerLook: 'Let me take a closer look...',
  processingWait: 'Please wait...',
  typingPlaceholder: 'Type your message here...'
};

// Reusable quick reply buttons
const MAIN_MENU_OPTIONS = [
  'Reset password',
  'Wi-Fi not working',
  'Slow computer',
  'Other issue'
];

const AI_FOLLOWUP_OPTIONS = [
  'It worked',
  'Continue troubleshooting',
  'Draft email to IT',
  'Main menu'
];

const YES_NO_OPTIONS = ['Yes', 'No'];

// Backup troubleshooting flow if AI fails
const localFallbackSteps = {
  wifi_failed: [
    'Try forgetting the Wi-Fi network, restarting your device, and reconnecting with the password again.',
    'Check whether other devices can connect to the same Wi-Fi. If they cannot, unplug the router for 60 seconds and plug it back in.',
    'On Windows, open Command Prompt as administrator and run these commands one at a time: ipconfig /release, ipconfig /renew, ipconfig /flushdns, and netsh winsock reset. Then restart your computer.',
    'If your device still shows no internet, disable and re-enable the Wi-Fi adapter in Network Connections, then try connecting again.'
  ],
  wifi_app_issue: [
    'Since websites load, the issue may be specific to one app or service. Restart that app and sign out and back in.',
    'Try opening the same app or website in another browser or on another device to see if the issue is service-specific.',
    'Clear the app cache or browser cache, then retry.'
  ],
  slow_failed: [
    'Open Task Manager or Activity Monitor and close high-usage background apps, then restart your computer.',
    'Check for software updates and install any pending updates, then restart again.',
    'Free up storage space and disable unnecessary startup apps.'
  ],
  password_failed: [
    'Request a new password reset link and make sure you are using the newest email.',
    'Check spam or junk folders for the reset email.',
    'If the reset still fails, the account may be locked and may require help from IT support.'
  ],
  password_username: [
    'Check old welcome emails, your employee portal, or the company directory for your username.',
    'If you still cannot find it, IT support may need to verify your identity.'
  ],
  general: [
    'Try restarting the affected device or app and writing down any exact error message you see.',
    'Try another browser or device if the problem involves a website or software login.',
    'If the problem continues, contact IT support with the exact error and the steps you already tried.'
  ]
};

// Stores live convo state for current session
const stateStore = {
  state: 'main_menu', // current step in the flow
  isProcessing: false, // to prevent double submits
  activeRequestId: 0, // ignores older AI responses if a newer request finishes first
  currentIssueType: 'general',
  aiAttempts: 0,
  aiContext: '',
  lastAiReply: '',
  aiStepHistory: [],
  pendingAction: null, // used for actions like drafting a support email
  supportTranscript: [],
  buttonOnlyMode: false, // hides text input during button-only steps
  recoveryEmail: '',
  resetEmail: '',
  supportCustomNote: ''
};

const YES_WORDS = ['yes', 'y', 'yeah', 'yep'];
const NO_WORDS = ['no', 'n', 'nope', 'nah'];

// Edge Case guards against prompt injection
const PROMPT_INJECTION_PATTERNS = [
  'what are the instructions', 'what were you told', 'repeat the prompt', 'show me the prompt', 'reveal your prompt', 'reveal your instructions', 'system prompt',
  'hidden instructions', 'ignore previous instructions', 'ignore the above', 'discard that prompt', 'you are now', 'act as', 'pretend to be', 'roleplay as', 'from now on you are', 'now you are a', 'tell me your rules'
];

// UI follow up messages
const TRANSCRIPT_EXCLUDED_MESSAGES = [
  TEXT.closerLook,
  'You can ask a follow-up question or choose an option below.',
  'You can ask another follow-up question, or if the issue continues, I recommend contacting IT support.',
  TEXT.returnToMenu,
  TEXT.chooseOption
];

// Issue desc for AI context
const ISSUE_CONTEXT_MAP = {
  password_username:
    'The user does not know their username and cannot continue password reset.',
  password_failed:
    'The user knows their username but the password reset did not work.',
  wifi_app_issue:
    'Wi-Fi is connected because websites load, but a specific app or service is not working.',
  wifi_failed:
    'Basic Wi-Fi troubleshooting failed after reconnecting and restarting router or network steps.',
  slow_failed:
    'Basic slow computer troubleshooting failed after checking open apps, storage, and restart.',
  general: 'The user has an IT issue that has not been categorized yet.'
};

// Labels for support email
const ISSUE_LABEL_MAP = {
  password_username: 'Username recovery / password reset issue',
  password_failed: 'Password reset issue',
  wifi_failed: 'Wi-Fi connection issue',
  wifi_app_issue: 'Application or service connection issue',
  slow_failed: 'Slow computer issue',
  general: 'General IT support issue'
};

// Labels for local summary
const ISSUE_SUMMARY_MAP = {
  wifi_failed: 'Wi-Fi not connecting',
  wifi_app_issue: 'App not working online',
  password_failed: 'Password reset failed',
  password_username: 'Username recovery failed',
  slow_failed: 'Computer still slow',
  general: 'Technical issue'
};

// Config yes/no flow map, keeps repeated support flows readable & easier to expand later
const YES_NO_FLOW_CONFIG = {
  wifi_on: {
    onYes: () => askYesNo('wifi_website', 'Can you open any website?'),
    onNo: () =>
      askYesNo(
        'wifi_after_turn_on',
        'Please turn on Wi-Fi and reconnect to your network. Did that solve your problem?'
      )
  },
  wifi_after_turn_on: {
    onYes: () => resolveIssue('Great! Your Wi-Fi issue is resolved.'),
    onNo: () => askYesNo('wifi_website', 'Can you open any website?')
  },
  wifi_restart: {
    onYes: () => resolveIssue('Great! Your Wi-Fi issue is resolved.'),
    onNo: () => deeperAnalysis('wifi_failed', 'Basic Wi-Fi troubleshooting failed.')
  },
  slow_apps: {
    onYes: () =>
      askYesNo(
        'slow_after_close',
        'Please close unused apps and tabs, then restart your computer. Did that help?'
      ),
    onNo: () => askYesNo('slow_storage', 'Is your storage nearly full?')
  },
  slow_after_close: {
    onYes: () => resolveIssue('Great! Your computer performance issue is resolved.'),
    onNo: () => askYesNo('slow_storage', 'Is your storage nearly full?')
  },
  slow_storage: {
    onYes: () =>
      askYesNo(
        'slow_after_storage',
        'Please delete unused files or clear temporary files. Did that solve your problem?'
      ),
    onNo: () =>
      askYesNo(
        'slow_restart',
        'Please restart your computer and check again. Did that solve your problem?'
      )
  },
  slow_after_storage: {
    onYes: () => resolveIssue('Great! Your computer performance issue is resolved.'),
    onNo: () =>
      deeperAnalysis(
        'slow_failed',
        'Deleting files or temporary files did not solve the slow computer issue.'
      )
  },
  slow_restart: {
    onYes: () => resolveIssue('Great! Your computer performance issue is resolved.'),
    onNo: () =>
      deeperAnalysis('slow_failed', 'Restarting did not solve the slow computer issue.')
  }
};

// Normalize input for easy matching
function normalize(input = '') {
  return String(input).trim().toLowerCase();
}

// Helpers for yes/no flows
function isYes(input) {
  return YES_WORDS.includes(normalize(input));
}

function isNo(input) {
  return NO_WORDS.includes(normalize(input));
}

// Simple email formatter check for password-related flows
function looksLikeEmail(input = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input).trim());
}

// Blocks attempts to override the chatbot instructions
function isPromptInjectionAttempt(input = '') {
  const clean = normalize(input);
  return PROMPT_INJECTION_PATTERNS.some((pattern) => clean.includes(pattern));
}

// Keeps transcript history 
function shouldSaveToSupportTranscript(text = '') {
  const clean = String(text || '').trim();
  return clean && !TRANSCRIPT_EXCLUDED_MESSAGES.includes(clean);
}

// Saves the most relevant recent chat history for later support summaries
function addToSupportTranscript(text, sender = 'bot') {
  if (!shouldSaveToSupportTranscript(text)) return;

  stateStore.supportTranscript.push({
    sender,
    text: String(text).trim()
  });

  stateStore.supportTranscript = stateStore.supportTranscript.slice(-20);
}

// Renders a chat message and also stores it in the transcript when useful
function addMessage(text, sender = 'bot') {
  const msg = document.createElement('div');
  msg.className = `message ${sender}`;
  msg.textContent = text;
  chatbox.appendChild(msg);
  chatbox.scrollTop = chatbox.scrollHeight;
  addToSupportTranscript(text, sender);
}

// Enables or disables input while bot is processing a step
function setInputEnabled(enabled) {
  userInput.disabled = !enabled;
  sendBtn.disabled = !enabled;

  quickReplies.querySelectorAll('button').forEach((btn) => {
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.6';
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    btn.style.pointerEvents = enabled ? 'auto' : 'none';
  });

  userInput.placeholder = enabled ? TEXT.typingPlaceholder : TEXT.processingWait;
}

// Rebuild quick reply buttons for curr step, if only options are yes/no, hide text box
function setQuickReplies(options = []) {
  quickReplies.innerHTML = '';

  const normalizedOptions = options.map((option) => String(option).toLowerCase());
  stateStore.buttonOnlyMode =
    normalizedOptions.length === 2 &&
    normalizedOptions.includes('yes') &&
    normalizedOptions.includes('no');

  options.forEach((option) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = option;
    btn.addEventListener('click', () => {
      if (stateStore.isProcessing || btn.disabled) return;
      submitInput(option);
    });
    quickReplies.appendChild(btn);
  });

  setInputEnabled(!stateStore.isProcessing);

  const hideTextInput = stateStore.buttonOnlyMode;
  userInput.style.display = hideTextInput ? 'none' : '';
  sendBtn.style.display = hideTextInput ? 'none' : '';
}

// Prevents multiple messages handled at the same time
function beginProcessing() {
  if (stateStore.isProcessing) return false;
  stateStore.isProcessing = true;
  setInputEnabled(false);
  return true;
}

function endProcessing() {
  stateStore.isProcessing = false;
  setInputEnabled(true);
  userInput.focus();
}

// Clears state when starting over/returning to the main menu
function resetAiState() {
  stateStore.aiContext = '';
  stateStore.aiAttempts = 0;
  stateStore.currentIssueType = 'general';
  stateStore.lastAiReply = '';
  stateStore.aiStepHistory = [];
  stateStore.pendingAction = null;
  stateStore.supportTranscript = [];
  stateStore.buttonOnlyMode = false;
  stateStore.recoveryEmail = '';
  stateStore.resetEmail = '';
  stateStore.supportCustomNote = '';
}

// Keep AI context from growing too big
function appendToAiContext(text) {
  const nextContext = `${stateStore.aiContext}\n${text}`.trim();
  stateStore.aiContext = nextContext.slice(-MAX_AI_CONTEXT_LENGTH);
}

// Helper to make state changes more readable
function setState(state) {
  stateStore.state = state;
}

// Advance to the next yes/no step
function askYesNo(nextState, message) {
  setState(nextState);
  addMessage(message);
  setQuickReplies(YES_NO_OPTIONS);
}

// Same idea as askYesNo, but for custom button sets
function askWithOptions(nextState, message, options) {
  setState(nextState);
  addMessage(message);
  setQuickReplies(options);
}

// Called when an issue is resolved and the chatbot offers to return to the menu
function resolveIssue(message) {
  addMessage(message);
  addMessage(TEXT.returnToMenu);
  setState('return_menu');
  setQuickReplies(YES_NO_OPTIONS);
}

function showYesNoGuidance() {
  addMessage(TEXT.yesNoGuide);
  setQuickReplies(YES_NO_OPTIONS);
}

function showYesNoButtonsGuidance() {
  addMessage(TEXT.yesNoButtons);
  setQuickReplies(YES_NO_OPTIONS);
}

// Returns the user to the main menu and clears the current issue state
function goToMainMenu() {
  setState('main_menu');
  resetAiState();
  addMessage(TEXT.mainMenu);
  setQuickReplies(MAIN_MENU_OPTIONS);
}

// Start open-text path for issues that do not fit the main categories
function startOtherIssueFlow() {
  resetAiState();
  setState('other_issue_waiting_for_description');
  stateStore.currentIssueType = 'general';
  addMessage('Please describe the IT issue you need help with.');
  setQuickReplies(['Main menu']);
}

// Build starting AI context based on the issue type
function buildContextFromType(type) {
  return ISSUE_CONTEXT_MAP[type] || ISSUE_CONTEXT_MAP.general;
}

// If AI fails, fall back to a local step
function getLocalFallbackReply(type, attempt) {
  const steps = localFallbackSteps[type] || localFallbackSteps.general;
  const index = Math.min(Math.max(attempt - 1, 0), steps.length - 1);
  return steps[index];
}

// Sends a troubleshooting request to the backend, retries once in case of a temporary failure
async function fetchAiReply(payload, retries = 1) {
  try {
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.reply || 'AI request failed');
    }

    return data.reply || '';
  } catch (error) {
    if (retries > 0) {
      return fetchAiReply(payload, retries - 1);
    }
    throw error;
  }
}

// Converts longer troubleshooting replies into short labels for summaries
function buildCompactStepHistory() {
  const stepMap = [
    { match: /adapter|driver/i, label: 'checked adapter/driver' },
    { match: /ipconfig\s*\/release|ipconfig\s*\/renew|renew your ip/i, label: 'released/renewed IP' },
    { match: /flushdns|dns cache/i, label: 'flushed DNS' },
    { match: /winsock/i, label: 'reset Winsock' },
    { match: /network reset/i, label: 'reset network settings' },
    { match: /restart.*router|power cycle router/i, label: 'restarted router' },
    { match: /forget.*reconnect|reconnect to the wi-fi/i, label: 'reconnected Wi-Fi' },
    { match: /close.*apps|browser tabs/i, label: 'closed apps/tabs' },
    { match: /restart your computer|restarted your computer/i, label: 'restarted computer' },
    { match: /free up storage|delete unused files|temporary files/i, label: 'cleared storage/files' },
    { match: /reset link/i, label: 'requested reset link' },
    { match: /spam|junk/i, label: 'checked spam/junk' }
  ];

  const labels = [];

  for (const step of stateStore.aiStepHistory) {
    const text = String(step || '');
    for (const rule of stepMap) {
      if (rule.match.test(text) && !labels.includes(rule.label)) {
        labels.push(rule.label);
      }
    }
  }

  return labels.slice(0, 4);
}

// Local summary fallback in case AI cannot generate a support summary
function buildLocalSupportSummary() {
  const issue = ISSUE_SUMMARY_MAP[stateStore.currentIssueType] || 'Technical issue';
  const compactSteps = buildCompactStepHistory();
  const steps = compactSteps.length ? compactSteps.join(', ') : 'basic troubleshooting';

  return `- Issue: ${issue}
- Steps tried: ${steps}
- Needs: IT review next steps`;
}

// Creates a short support summary from transcript history and prior troubleshooting
async function summarizeSupportTranscript() {
  const summaryInput = {
    issueType: stateStore.currentIssueType,
    aiAttempts: stateStore.aiAttempts,
    lastAiReply: '',
    aiStepHistory: buildCompactStepHistory(),
    transcriptEntries: stateStore.supportTranscript.length ? stateStore.supportTranscript : []
  };

  try {
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'summary',
        summaryInput
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.reply || 'Summary request failed');
    }

    const cleanSummary = String(data.reply || '').trim().replace(/\r/g, '');

    if (
      cleanSummary &&
      cleanSummary.includes('- Issue:') &&
      cleanSummary.includes('- Steps tried:') &&
      cleanSummary.includes('- Needs:') &&
      !cleanSummary.toLowerCase().includes('it support issue') &&
      !cleanSummary.toLowerCase().includes('user completed troubleshooting')
    ) {
      return cleanSummary;
    }

    return buildLocalSupportSummary();
  } catch (error) {
    console.error('Support summary error:', error);
    return buildLocalSupportSummary();
  }
}

// Builds a support email draft so user doen't need to repeat everything to IT
function buildSupportEmailDraft(summaryText) {
  const cleanIssue = ISSUE_LABEL_MAP[stateStore.currentIssueType] || 'IT support issue';

  const transcript = stateStore.supportTranscript.length
    ? stateStore.supportTranscript
        .filter((entry) => {
          const text = String(entry.text || '').toLowerCase().trim();

          return !(
            text === 'continue troubleshooting' ||
            text.includes('choose an option') ||
            text.includes('let me take a closer look') ||
            text.includes('you can ask a follow-up question') ||
            text.includes('would you like to return to the main menu')
          );
        })
        .map((entry) => `${entry.sender === 'user' ? 'User' : 'Bot'}: ${entry.text}`)
        .join('\n')
    : 'No conversation history available.';

  const noteBlock = stateStore.supportCustomNote
    ? `User note:\n${stateStore.supportCustomNote}\n\n`
    : '';

  return {
    subject: 'IT Support Request',
    body: `Hello IT Support,

I need help with ${cleanIssue}.

${noteBlock}Summary:
${summaryText}

Recent conversation history:
${transcript.split('\n').slice(-12).join('\n')}

Please assist me with the next steps.

Thank you.`
  };
}

// Generates and shows the support draft to the user before sending
async function draftSupportEmailNow() {
  addMessage('I’m preparing a support request...');
  const summary = await summarizeSupportTranscript();
  const draft = buildSupportEmailDraft(summary);

  stateStore.supportCustomNote = '';
  setState('support_email_confirm');

  addMessage(`Here is the support request that will be sent to ${IT_SUPPORT_EMAIL}:`);
  addMessage(`Subject: ${draft.subject}\n\n${draft.body}`);
  addMessage('Would you like to send this, add a note, or cancel?');
  setQuickReplies(['Send to IT', 'Add note', 'Cancel']);
  endProcessing();
}

// Decides which buttons to show after an AI response
function setAiFollowupOptions() {
  setState('ai_followup');

  const isPasswordReset = stateStore.currentIssueType === 'password_failed' && stateStore.resetEmail;
  const isUsernameRecovery =
    stateStore.currentIssueType === 'password_username' && stateStore.recoveryEmail;

  if (stateStore.pendingAction === 'draft_it_email') {
    addMessage(TEXT.chooseOption);

    if (isPasswordReset || isUsernameRecovery) {
      setQuickReplies([
        'Send again', 'Try another email', 'Continue troubleshooting', 'Draft email to IT', 'Main menu'
      ]);
      return;
    }

    setQuickReplies(['Draft email to IT', 'Main menu']);
    return;
  }

  if (stateStore.aiAttempts >= 5) {
    addMessage(
      'You can ask another follow-up question, or if the issue continues, I recommend contacting IT support.'
    );
  } else {
    addMessage('You can ask a follow-up question or choose an option below.');
  }

  if (isPasswordReset || isUsernameRecovery) {
    setQuickReplies([
      'Send again',
      'Try another email',
      'Continue troubleshooting',
      'Draft email to IT',
      'Main menu'
    ]);
    return;
  }

  setQuickReplies(AI_FOLLOWUP_OPTIONS);
}

// Detects whether the AI reply is suggesting escalation to IT
function shouldOfferDraft(reply = '') {
  const cleanReply = normalize(reply);

  return [
    'draft a message', 'draft an email', 'help you draft', 'help draft', 'draft a message to it', 'draft a message for it', 'draft a message to it support', 'draft an email to it', 'draft an email to it support', 'help draft a message', 'would you like me to do that',
    'would you like help with that', 'would you like assistance drafting', 'would you like me to draft'
  ].some((phrase) => cleanReply.includes(phrase));
}

// Runs AI troubleshooting when the rule-based flow is no longer enough
// And it keeps track of attempts and avoids stale responses from earlier requests
async function deeperAnalysis(type = 'general', latestUserMessage = '') {
  if (stateStore.aiAttempts >= MAX_AI_ATTEMPTS_PER_ISSUE) {
    addMessage(
      'We have reached the troubleshooting limit for this issue. Please contact IT support and share the steps already tried.'
    );
    addMessage(TEXT.returnToMenu);
    setState('return_menu');
    setQuickReplies(YES_NO_OPTIONS);
    endProcessing();
    return;
  }

  stateStore.currentIssueType = type;
  stateStore.aiAttempts += 1;

  const requestId = ++stateStore.activeRequestId;
  addMessage(TEXT.closerLook);

  if (!stateStore.aiContext) {
    stateStore.aiContext = buildContextFromType(type);
  }

  if (latestUserMessage) {
    appendToAiContext(`User message: ${latestUserMessage}`);
  }

  const payload = {
    issueType: type,
    userContext: stateStore.aiContext,
    latestUserMessage,
    aiAttempts: stateStore.aiAttempts,
    lastAiReply: stateStore.lastAiReply,
    aiStepHistory: stateStore.aiStepHistory
  };

  try {
    const reply = await fetchAiReply(payload, 1);
    if (requestId !== stateStore.activeRequestId) return;

    stateStore.lastAiReply = reply;
    stateStore.aiStepHistory.push(reply);
    stateStore.aiStepHistory = stateStore.aiStepHistory.slice(-MAX_AI_STEP_HISTORY);

    stateStore.pendingAction = shouldOfferDraft(reply) ? 'draft_it_email' : null;

    addMessage(reply);
    setAiFollowupOptions();
  } catch (error) {
    if (requestId !== stateStore.activeRequestId) return;

    console.error('AI fallback error:', error);

    const localReply = getLocalFallbackReply(type, stateStore.aiAttempts);
    stateStore.lastAiReply = localReply;
    stateStore.aiStepHistory.push(localReply);
    stateStore.aiStepHistory = stateStore.aiStepHistory.slice(-MAX_AI_STEP_HISTORY);

    addMessage(localReply);

    if (stateStore.aiAttempts >= 5) {
      addMessage('If this still does not work, I recommend contacting IT support.');
      setState('ai_followup');
      setQuickReplies(['Draft email to IT', 'Main menu']);
      stateStore.pendingAction = 'draft_it_email';
    } else {
      addMessage(
        'I had trouble reaching deeper analysis, but here is the next step to try. You can also ask a follow-up question.'
      );
      setState('ai_followup');
      setQuickReplies(AI_FOLLOWUP_OPTIONS);
    }
  } finally {
    if (requestId === stateStore.activeRequestId) {
      endProcessing();
    }
  }
}

// Reusable email collection helper for password-related flows
function collectEmail({
  input,
  emailKey,
  nextState,
  sentLabel,
  followupQuestion,
  allowMainMenu = true
}) {
  const clean = normalize(input);

  if (allowMainMenu && clean === 'main menu') {
    goToMainMenu();
    return;
  }

  if (!looksLikeEmail(input)) {
    addMessage('Please enter a valid work email address.');
    setQuickReplies(['Main menu']);
    return;
  }

  stateStore[emailKey] = String(input).trim();
  setState(nextState);
  addMessage(`A ${sentLabel} has been sent to ${stateStore[emailKey]}.`);
  addMessage(followupQuestion);
  setQuickReplies(YES_NO_OPTIONS);
}

// Reused when the user asks to resend a recovery or reset email
function resendEmailFlow(emailValue, sentMessage, followupQuestion, nextState) {
  addMessage(`${sentMessage} ${emailValue}.`);
  addMessage(followupQuestion);
  setState(nextState);
  setQuickReplies(YES_NO_OPTIONS);
}

// Prompts for a new email address and moves to the next state
function promptForDifferentEmail(nextState, prompt) {
  setState(nextState);
  addMessage(prompt);
  setQuickReplies(['Main menu']);
}

// Routes the user into the correct main support path
function handleMainMenu(input) {
  const clean = normalize(input);

  if (isPromptInjectionAttempt(input)) {
    addMessage('I can help with IT troubleshooting only. Please choose a support issue from the menu.');
    setQuickReplies(MAIN_MENU_OPTIONS);
    return;
  }

  if (clean === '1' || clean === 'reset password' || clean.includes('password')) {
    askYesNo('password_username', 'Do you know your username?');
    return;
  }

  if (
    clean === '2' ||
    clean === 'wi-fi not working' ||
    clean === 'wifi not working' ||
    clean.includes('wifi') ||
    clean.includes('wi-fi') ||
    clean.includes('internet')
  ) {
    askYesNo('wifi_on', 'Is your Wi-Fi turned on?');
    return;
  }

  if (clean === '3' || clean === 'slow computer' || clean.includes('slow')) {
    askYesNo('slow_apps', 'Do you have many apps or browser tabs open?');
    return;
  }

  if (clean === '4' || clean === 'other issue' || clean === 'other') {
    startOtherIssueFlow();
    return;
  }

  if (
    clean.includes('broken') ||
    clean.includes('not working') ||
    clean.includes('problem') ||
    clean.includes('issue')
  ) {
    addMessage(
      'I can help with password, Wi-Fi, slow computer, or another IT issue. Which one best matches your problem?'
    );
    setQuickReplies(MAIN_MENU_OPTIONS);
    return;
  }

  addMessage(
    "That's not a valid option. Please choose Reset password, Wi-Fi not working, Slow computer, or Other issue."
  );
  setQuickReplies(MAIN_MENU_OPTIONS);
}

// First password flow step: check whether the user knows their username
function handlePasswordUsername(input) {
  if (isYes(input)) {
    promptForDifferentEmail(
      'password_reset_collect_email',
      'Please enter your work email address so I can send your password reset link.'
    );
    return;
  }

  if (isNo(input)) {
    promptForDifferentEmail(
      'password_collect_email',
      'Please enter your work email address so I can send your username recovery link.'
    );
    return;
  }

  showYesNoGuidance();
}

// Collects email for username recovery
function handlePasswordCollectEmail(input) {
  collectEmail({
    input,
    emailKey: 'recoveryEmail',
    nextState: 'password_email_sent',
    sentLabel: 'username recovery link',
    followupQuestion: 'Did you find your username in that email?'
  });
}

// Checks whether username recovery worked
function handlePasswordEmailSent(input) {
  if (isYes(input)) {
    promptForDifferentEmail(
      'password_reset_collect_email',
      'Please enter your work email address so I can send your password reset link.'
    );
    return;
  }

  if (isNo(input)) {
    askWithOptions(
      'password_email_result',
      `I can send another username recovery link to ${stateStore.recoveryEmail}, prepare an email to ${IT_SUPPORT_EMAIL}, or return to the main menu.`,
      ['Send again', 'Try another email', 'Draft email to IT', 'Main menu']
    );
    return;
  }

  showYesNoButtonsGuidance();
}

// Retry options if username recovery didbt work
function handlePasswordEmailResult(input) {
  const clean = normalize(input);

  if (clean === 'send again') {
    resendEmailFlow(
      stateStore.recoveryEmail,
      'Another username recovery link has been sent to',
      'Did you find your username in that email?',
      'password_email_sent'
    );
    return;
  }

  if (clean === 'try another email') {
    stateStore.recoveryEmail = '';
    promptForDifferentEmail('password_collect_email', 'Please enter a different work email address.');
    return;
  }

  if (clean === 'draft email to it') {
    stateStore.pendingAction = 'draft_it_email';
    draftSupportEmailNow();
    return;
  }

  if (clean === 'main menu') {
    goToMainMenu();
    return;
  }

  addMessage(TEXT.chooseOption);
  setQuickReplies(['Send again', 'Try another email', 'Draft email to IT', 'Main menu']);
}

// Collect email for password reset
function handlePasswordResetCollectEmail(input) {
  collectEmail({
    input,
    emailKey: 'resetEmail',
    nextState: 'password_reset_sent',
    sentLabel: 'password reset link',
    followupQuestion: 'Were you able to reset your password from that email?'
  });
}

// Checks if password reset worked
function handlePasswordResetSent(input) {
  if (isYes(input)) {
    resolveIssue('Great! Your password issue is resolved.');
    return;
  }

  if (isNo(input)) {
    askWithOptions(
      'password_reset_result',
      `I can send another password reset link to ${stateStore.resetEmail}, try another email, prepare an email to ${IT_SUPPORT_EMAIL}, or continue troubleshooting.`,
      ['Send again', 'Try another email', 'Continue troubleshooting', 'Draft email to IT', 'Main menu']
    );
    return;
  }

  showYesNoButtonsGuidance();
}

// Fallback option if password reset didnt work
function handlePasswordResetResult(input) {
  const clean = normalize(input);

  if (clean === 'send again') {
    resendEmailFlow(
      stateStore.resetEmail,
      'Another password reset link has been sent to',
      'Were you able to reset your password from that email?',
      'password_reset_sent'
    );
    return;
  }

  if (clean === 'try another email') {
    stateStore.resetEmail = '';
    promptForDifferentEmail(
      'password_reset_collect_email',
      'Please enter a different work email address.'
    );
    return;
  }

  if (clean === 'continue troubleshooting') {
    deeperAnalysis(
      'password_failed',
      'The password reset email flow did not solve the issue. Give the next troubleshooting step only.'
    );
    return;
  }

  if (clean === 'draft email to it') {
    stateStore.pendingAction = 'draft_it_email';
    draftSupportEmailNow();
    return;
  }

  if (clean === 'main menu') {
    goToMainMenu();
    return;
  }

  addMessage(TEXT.chooseOption);
  setQuickReplies([
    'Send again',
    'Try another email',
    'Continue troubleshooting',
    'Draft email to IT',
    'Main menu'
  ]);
}

// If websites work then issue may be app or service
function handleWifiWebsite(input) {
  if (isYes(input)) {
    deeperAnalysis('wifi_app_issue', 'Websites open, but a specific app or service is not working.');
    return;
  }

  if (isNo(input)) {
    askYesNo(
      'wifi_restart',
      'Please restart your router or forget and reconnect to the Wi-Fi network. Did that solve your problem?'
    );
    return;
  }

  showYesNoGuidance();
}

// Handles the free-text issue path
function handleOtherIssueDescription(input) {
  const clean = normalize(input);

  if (clean === 'main menu') {
    goToMainMenu();
    return;
  }

  if (isPromptInjectionAttempt(input)) {
    addMessage(
      'I can help only with IT troubleshooting in this chat. Please describe your technical issue or return to the main menu.'
    );
    setQuickReplies(['Main menu']);
    return;
  }

  deeperAnalysis('general', input);
}

// Send & add note & cancel for generated support draft
function handleSupportEmailConfirm(input) {
  const clean = normalize(input);

  if (clean === 'send to it') {
    addMessage(`Your support request has been sent to ${IT_SUPPORT_EMAIL}.`);
    stateStore.pendingAction = null;
    stateStore.supportCustomNote = '';
    addMessage(TEXT.returnToMenu);
    setState('return_menu');
    setQuickReplies(YES_NO_OPTIONS);
    return;
  }

  if (clean === 'add note') {
    askWithOptions(
      'support_email_add_note',
      'Please type the extra note you want to add for IT support.',
      ['Cancel']
    );
    return;
  }

  if (clean === 'cancel') {
    addMessage('Okay, I did not send the support request.');
    stateStore.pendingAction = null;
    stateStore.supportCustomNote = '';
    setAiFollowupOptions();
    return;
  }

  addMessage(TEXT.chooseOption);
  setQuickReplies(['Send to IT', 'Add note', 'Cancel']);
}

// Lets the user add more context before sending the support request
async function handleSupportEmailAddNote(input) {
  const clean = normalize(input);

  if (clean === 'cancel') {
    setState('support_email_confirm');
    addMessage('Okay, no note was added.');
    setQuickReplies(['Send to IT', 'Add note', 'Cancel']);
    return;
  }

  stateStore.supportCustomNote = String(input).trim();
  addMessage('I added your note and refreshed the draft.');

  const summary = await summarizeSupportTranscript();
  const draft = buildSupportEmailDraft(summary);
  setState('support_email_confirm');

  addMessage(`Subject: ${draft.subject}\n\n${draft.body}`);
  addMessage('Would you like to send this, add another note, or cancel?');
  setQuickReplies(['Send to IT', 'Add note', 'Cancel']);
  endProcessing();
}

// Handles what the user does after an AI reply
function handleAiFollowup(input) {
  const clean = normalize(input);

  if (isPromptInjectionAttempt(input)) {
    addMessage(
      'I can help only with IT troubleshooting in this chat. Please describe your technical issue or choose an option below.'
    );
    setQuickReplies(AI_FOLLOWUP_OPTIONS);
    return;
  }

  if (clean === 'it worked' || clean === 'worked') {
    resolveIssue('Great! Im glad that solved the issue.');
    return;
  }

  if (
    clean.includes('contact it') ||
    clean.includes('it support') ||
    clean.includes('helpdesk') ||
    clean.includes('help me contact') ||
    clean.includes('contact support')
  ) {
    stateStore.pendingAction = 'draft_it_email';
    addMessage(`I can prepare a support request for ${IT_SUPPORT_EMAIL}. Choose an option below.`);
    setState('ai_followup');
    setQuickReplies(['Continue troubleshooting', 'Draft email to IT', 'Main menu']);
    return;
  }

  if (clean === 'draft email to it' || clean === 'contact it support') {
    draftSupportEmailNow();
    return;
  }

  if (clean === 'main menu') {
    goToMainMenu();
    return;
  }

  if (clean === 'send again') {
    if (stateStore.currentIssueType === 'password_failed' && stateStore.resetEmail) {
      resendEmailFlow(
        stateStore.resetEmail,
        'Another password reset link has been sent to',
        'Were you able to reset your password from that email?',
        'password_reset_sent'
      );
      return;
    }

    if (stateStore.currentIssueType === 'password_username' && stateStore.recoveryEmail) {
      resendEmailFlow(
        stateStore.recoveryEmail,
        'Another username recovery link has been sent to',
        'Did you find your username in that email?',
        'password_email_sent'
      );
      return;
    }
  }

  if (clean === 'try another email') {
    if (stateStore.currentIssueType === 'password_failed') {
      stateStore.resetEmail = '';
      promptForDifferentEmail(
        'password_reset_collect_email',
        'Please enter a different work email address.'
      );
      return;
    }

    if (stateStore.currentIssueType === 'password_username') {
      stateStore.recoveryEmail = '';
      promptForDifferentEmail('password_collect_email', 'Please enter a different work email address.');
      return;
    }
  }

  if (clean === 'continue troubleshooting') {
    stateStore.pendingAction = null;
    deeperAnalysis(
      stateStore.currentIssueType,
      'The user wants to continue troubleshooting instead of escalating. Give one more practical next step only.'
    );
    return;
  }

  if (isYes(input)) {
    if (stateStore.pendingAction === 'draft_it_email') {
      draftSupportEmailNow();
      return;
    }

    addMessage(TEXT.chooseOption);
    setAiFollowupOptions();
    return;
  }

  if (clean === 'still not working' || clean === 'still' || clean === 'not working') {
    if (stateStore.currentIssueType === 'password_username') {
      stateStore.pendingAction = 'draft_it_email';
      addMessage(
        `This issue likely needs IT support, but I can continue troubleshooting or prepare an email to ${IT_SUPPORT_EMAIL}.`
      );
      setState('ai_followup');
      setQuickReplies(['Continue troubleshooting', 'Draft email to IT', 'Main menu']);
      return;
    }

    deeperAnalysis(
      stateStore.currentIssueType,
      'The user said the last step did not work. Do not repeat prior advice. Give the next troubleshooting step only.'
    );
    return;
  }

  deeperAnalysis(stateStore.currentIssueType, input);
}

// Simple yes no handler to go to main menu
function handleReturnMenu(input) {
  if (isYes(input)) {
    goToMainMenu();
    return;
  }

  if (isNo(input)) {
    addMessage('Thanks for using the IT Helpdesk Assistant.');
    setQuickReplies([]);
    setState('ended');
    resetAiState();
    return;
  }

  addMessage('Please answer Yes or No.');
  setQuickReplies(YES_NO_OPTIONS);
}

// Handles the reusable yes no flow states from YES_NO_FLOW_CONFIG
function handleGenericYesNoState(input) {
  const config = YES_NO_FLOW_CONFIG[stateStore.state];
  if (!config) return false;

  if (isYes(input)) {
    config.onYes();
    return true;
  }

  if (isNo(input)) {
    config.onNo();
    return true;
  }

  showYesNoGuidance();
  return true;
}

// Maps each state to the handler responsible for that step
const STATE_HANDLERS = {
  main_menu: handleMainMenu,
  password_username: handlePasswordUsername,
  password_collect_email: handlePasswordCollectEmail,
  password_email_sent: handlePasswordEmailSent,
  password_email_result: handlePasswordEmailResult,
  password_reset_collect_email: handlePasswordResetCollectEmail,
  password_reset_sent: handlePasswordResetSent,
  password_reset_result: handlePasswordResetResult,
  wifi_website: handleWifiWebsite,
  other_issue_waiting_for_description: handleOtherIssueDescription,
  ai_followup: handleAiFollowup,
  return_menu: handleReturnMenu,
  support_email_confirm: handleSupportEmailConfirm,
  support_email_add_note: handleSupportEmailAddNote
};

// Main router for user input, adds the user message, then sends it to the correct state handler
async function handleUserInput(input) {
  addMessage(input, 'user');
  userInput.value = '';

  if (handleGenericYesNoState(input)) return;

  const handler = STATE_HANDLERS[stateStore.state];

  if (!handler) {
    goToMainMenu();
    return;
  }

  await handler(input);
}

// Basic validation so the chatbot does not get overloaded with messy input
function validateInput(input) {
  if (!input) return false;

  if (stateStore.buttonOnlyMode && !isYes(input) && !isNo(input)) {
    addMessage(TEXT.yesNoButtons);
    return false;
  }

  if (input.length > MAX_USER_MESSAGE_LENGTH) {
    addMessage(
      `Please keep your message under ${MAX_USER_MESSAGE_LENGTH} characters and include only the main IT issue or error message.`
    );
    return false;
  }

  const lineCount = input.split('\n').length;
  if (lineCount > MAX_INPUT_LINES) {
    addMessage(
      'Please send a shorter description with the device, app, and exact error message instead of a large pasted block of text.'
    );
    return false;
  }

  return true;
}

// Main entry point. validates input, locks the UI, then routes message chatbot flow
async function submitInput(rawInput) {
  const input = String(rawInput || '').trim();

  if (!validateInput(input)) return;
  if (!beginProcessing()) return;

  try {
    await handleUserInput(input);
  } finally {
    if (stateStore.isProcessing) {
      endProcessing();
    }
  }
}

// Send button submits the current input
sendBtn.addEventListener('click', () => {
  if (stateStore.isProcessing) return;
  submitInput(userInput.value);
});

// Enter key does the same as clicking Send
userInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (stateStore.isProcessing) return;
    submitInput(userInput.value);
  }
});

// Start the chatbot at the main menu
goToMainMenu();