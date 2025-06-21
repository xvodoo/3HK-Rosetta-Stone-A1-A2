// src/lib/env.ts
var FoundationsTimeRequestKey = "foundations_time_request";
var FoundationsCourseRequestKey = "foundations_course_request";
var FluencyBuilderTimeRequestKey = "fluency_builder_time_request";
var BeforeSendHeadersParams = ["requestHeaders"];
var BeforeSendRequestParams = ["requestBody"];
var FoundationsRequestFilter = {
  urls: ["https://tracking.rosettastone.com/*"]
};
var FluencyBuilderRequestFilter = {
  urls: [
    "https://graph.rosettastone.com/graphql*",
    "https://gaia-server.rosettastone.com/graphql*"
  ]
};

// src/worker/request.ts
function storeRequest(key) {
  return async (req) => {
    const slice = {};
    slice[key] = req;
    console.log("GetTutoringSummary:", req);
    console.debug(`Storing request at "${key}"`, req);
    await chrome.storage.session.set(slice);
  };
}

function requestFromObject(req) {
  let body = null;
  if (req.requestBody != null) {
    body = new TextDecoder().decode(req.requestBody.raw[0].bytes);
  }
  const headers = {};
  if (req.requestHeaders !== void 0)
    req.requestHeaders.forEach(({ name, value }) => headers[name] = value);
  else if (req.headers !== void 0)
    Object.entries(req.headers).forEach(
      ([name, value]) => headers[name] = value
    );
  let timestamp;
  if (req.timeStamp != null) timestamp = new Date(req.timeStamp);
  else timestamp = /* @__PURE__ */ new Date();
  return {
    ...req,
    body,
    timestamp,
    headers
  };
}
var foundationsTimeRequest = {
  filter: (details) => {
    if (details.method !== "POST" || details.tabId === -1) return false;
    const url = URL.parse(details.url);
    return url?.pathname?.endsWith("path_scores") || false;
  },
  onMatched: storeRequest(FoundationsTimeRequestKey)
};
var foundationsCourseRequest = {
  filter: (details) => {
    if (details.method !== "GET" || details.tabId === -1) return false;
    const url = URL.parse(details.url);
    return url?.pathname?.endsWith("path_step_scores") || false;
  },
  onMatched: storeRequest(FoundationsCourseRequestKey)
};
var fluencyBuilderTimeRequest = {
  filter: (details) => {
    if (details.method !== "POST" || details.body === null || details.tabId === -1)
      return false;
    const url = URL.parse(details.url);
    if (url?.pathname !== "/graphql") return false;
    const body = JSON.parse(details.body);
    return body.operationName === "GetTutoringSummary" || body.operationName === "AddProgress";
  },
  onMatched: storeRequest(FluencyBuilderTimeRequestKey)
};
function shouldCaptureWritingRequest(request) {
  return (
    request.method === "POST" &&
    request.url.includes("path_scores?course") &&
    request.url.includes("path_type=writing") &&
    request.url.includes("occurrence=1") &&
    request.url.includes("_method=put")
  );
}
function extractRequestBody(req) {
  if (req.requestBody && req.requestBody.raw && req.requestBody.raw[0]) {
    const bytes = new Uint8Array(req.requestBody.raw[0].bytes);
    return new TextDecoder("utf-8").decode(bytes);
  }
  return null;
}

// src/lib/url.ts 
let lastWritingPathScoreUrl = null;

async function saveWritingPathScoreUrl(req) {
  if (
    req.method === "POST" &&
    req.url.startsWith("https://tracking.rosettastone.com/") &&
    req.url.includes("path_scores?course") &&
    req.url.includes("path_type=") &&
    req.url.endsWith("&occurrence=1&_method=put")
  ) {
    await storeRequest("lastWritingRequest")(req)
    lastWritingPathScoreUrl = req.url;
    console.log("Writing PathScore URL saved:", lastWritingPathScoreUrl);
    chrome.storage.session.set({ lastWritingPathScoreUrl: req.url });
  }
     if (req.headers && typeof req.headers === "object") {
       console.info("  x-rosettastone-session-token:", req.headers["x-rosettastone-session-token"] || " Not found");
       if (req.body) {
          const match = req.body.match(/<path_score>[\s\S]*?<delta_time>0<\/delta_time>[\s\S]*?<\/path_score>/);
          if (match) {
            console.info("🧾 Body:", match[0]);
          } else {
            console.info("🔵 [Rosetta] لا يوجد path بـ 0 في هذا body.");
            console.debug("🧾 Skipped logging body: it’s empty or already logged.");
          }
        } else {
         console.warn("⚠️ req.headers is missing or not an object");
        }
      }
}

function setupRequestListeners(urlFilters, filters) {
  const requestBuffers = {};

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const req = requestFromObject(details); // فيه body
    requestBuffers[details.requestId] = req;

    if (shouldCaptureWritingRequest(details)) {
      const body = extractRequestBody(details);
      const requestToSave = { ...details, body, timestamp: new Date().toISOString() };
      await storeRequest("lastWritingRequest")(requestToSave);
      console.log(" Writing request saved:", requestToSave);
    }
  },
  urlFilters,
  BeforeSendRequestParams
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  async (details) => {
    const req = requestBuffers[details.requestId];
    if (!req) return;

    if (details.requestHeaders) {
      details.requestHeaders.forEach(({ name, value }) => {
        req.headers[name] = value;
      });
    }

    // ✅ حفظ headers + body معا
    await saveWritingPathScoreUrl(req);

    // 🧹 مسح من الكاش
    delete requestBuffers[details.requestId];
  },
  urlFilters,
  BeforeSendHeadersParams
);
}
function setupListeners() {
  setupRequestListeners(FoundationsRequestFilter, [
    foundationsTimeRequest,
    foundationsCourseRequest
  ]);
  setupRequestListeners(FluencyBuilderRequestFilter, [
    fluencyBuilderTimeRequest
  ]);
  chrome.webRequest.onBeforeSendHeaders.addListener(
    async (details) => {
      if (details.method !== "POST" || details.tabId !== -1)
        return details;
      if (details.requestHeaders != null) {
        for (let i = 0; i < details.requestHeaders.length; ++i) {
          if (details.requestHeaders[i].name === "Origin") {
            details.requestHeaders.splice(i, 1);
            break;
          }
        }
        details.requestHeaders.push({
          name: "Origin",
          value: "https://tracking.rosettastone.com/"
        });
        return { requestHeaders: details.requestHeaders };
      } else {
      }
    },
    FoundationsRequestFilter,
    ["requestHeaders"]
  );
}

// src/lib/product.ts
function getProductFromUrl(url) {
  switch (url.hostname) {
    case "totale.rosettastone.com":
      return "foundations" /* Foundations */;
    case "learn.rosettastone.com":
      return "fluency builder" /* FluencyBuilder */;
    default:
      throw new Error("Invalid site for product");
  }
}

// src/worker/tab.ts
function onTabUpdate(tab) {
  const effectiveUrl = URL.parse(tab.url);
  if (effectiveUrl === null) return;
  try {
    getProductFromUrl(effectiveUrl);
    chrome.action.enable(tab.id);
  } catch (_e) {
    chrome.action.disable(tab.id);
  }
}
function setupTabListeners() {
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, onTabUpdate);
  });
  chrome.tabs.onUpdated.addListener(
    (_tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete") onTabUpdate(tab);
    }
  );
}

// src/worker/index.ts
setupListeners();
setupTabListeners();
const currentVersion = '2.1.0';
// Fetch the latest version from the remote JSON file

const versionUrl = 'https://raw.githubusercontent.com/xvodoo/3HK-Rosetta-Stone-A1-A2/main/version.json';

async function checkForUpdates() {
  try {
    const res = await fetch(versionUrl);
    const data = await res.json();

    if (data.version !== currentVersion) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'static/update.png',
        title: '3HK - Rosetta Stone Update',
        message: `New update ${data.version} is available. Please visit the channel and download the latest version.`,
        priority: 2
      });
      return { success: true, update: true, version: data.version };
    } else {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'static/update.png',
        title: '3HK - Rosetta Stone Update',
        message: `You have the latest version (${currentVersion}).`,
        priority: 2
      });
      return { success: true, update: false, version: data.version };
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
    return { success: false, error: error.message };
  }
}
fetch('https://raw.githubusercontent.com/xvodoo/3HK-Rosetta-Stone-A1-A2/main/version.json')
  .then(response => response.json())
  .then(data => {
    const latestVersion = data.version;
    console.info("Ξ 3HK- Successfully started RosettaStonks");
    console.info(currentVersion, "version of the extension");
    console.info("Latest version:", latestVersion);

    if (latestVersion !== currentVersion) {
      console.log(" Update available! ");
    }
  })
  .catch(err => {
    console.error('Failed to fetch latest version:', err);
  });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === 'manual-check-update') {
    checkForUpdates().then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; 
  }});
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {

    chrome.tabs.create({
      url: "https://whatsapp.com/channel/0029Vb62RTF0G0XeN4Qx4c3W"
    });
  }
});
