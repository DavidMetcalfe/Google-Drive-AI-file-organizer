/**
 * =================================================================================================
 * Gemini Powered Google Drive Organizer
 * =================================================================================================
 *
 * @description
 * This Google Apps Script provides a powerful, automated solution for organizing files in Google
 * Drive. It uses a robust, stateful caching and batch processing system to avoid timeouts, even
 * with very large Google Drive accounts.
 *
 * @workflow
 * 1.  **Stateful Folder Caching (Infrequent, Chained Execution)**:
 *     a. A time-based trigger runs `startFolderScan` periodically (default: daily) to scan
 *        your entire Google Drive folder structure.
 *     b. This process is broken into small, chained executions to avoid Google's 6-minute
 *        runtime limit, ensuring even huge Drives can be fully scanned.
 * 2.  **File Processing (Frequent)**: The main `scanFolderAndProcessFiles` function runs on a
 *     10-minute trigger. It reads the folder cache and processes a small batch of files from
 *     your source folder.
 *
 * @configuration
 * - **SOURCE_FOLDER_NAME**: The name of the folder where you drop files to be processed.
 *   Default is "Scanned content".
 * - **BATCH_SIZE**: The max number of files to process per run. Default is 5. Keep this low
 *   to avoid timeouts.
 * - **MAX_RUNTIME_SECONDS**: The time a folder scan runs before pausing and chaining to the
 *   next execution. Default is 240 (4 minutes).
 * - **FOLDER_CACHE_REFRESH_HOURS**: How often (in hours) to rescan your Drive folder
 *   structure. Default is 24 (daily). Supports multi-day intervals (e.g., 168 for a week).
 *
 * @setup_instructions
 * 1.  **Configure Script**: Review and adjust the settings under "Global Configuration" to your
 *     needs (especially `SOURCE_FOLDER_NAME`).
 * 2.  **Set API Key**: In the `MANUALLY_SET_API_KEY` function, paste your Gemini API key.
 * 3.  **Run Setup**: Select `SETUP_SCRIPT_AND_AUTHORIZE` from the function menu and click "▶ Run".
 *     This saves your key, creates triggers, and starts the first folder scan.
 *
 * @version 2.4
 * @OnlyCurrentDoc
 */

// --- Global Configuration ---
const SOURCE_FOLDER_NAME = "Scanned content";
const BATCH_SIZE = 5; // Process up to 5 files per run to avoid timeouts.
const MAX_RUNTIME_SECONDS = 240; // Run for 4 minutes before chaining to the next execution.
const FOLDER_CACHE_REFRESH_HOURS = 24; // How often to rescan the entire folder structure.
const FOLDER_BATCH_SIZE = 100; // Process this many folders per continuation before checking runtime

// --- Folder Blacklisting ---
// Folders to exclude from scanning and indexing. Supports both folder names and full paths:
// - Simple folder name: "Photos" (excludes any folder named "Photos" and all its children)
// - Full path from root: "School/Highschool" (excludes only the "Highschool" folder within "School")
const BLACKLISTED_PATHS = [
  // Examples (remove or modify as needed):
  // "Photos",           // Excludes any folder named "Photos"
  // "School/Highschool", // Excludes only "School/Highschool" path
  // "Archive",          // Excludes any folder named "Archive"
];

// --- File Size Configuration ---
const MAX_FILE_SIZE_MB = 18; // Maximum size for files (limit of Gemini's API with inline content) over the inline limit

// --- API Configuration ---
const AI_PLATFORM = "GEMINI";                     // Options: "GEMINI", "OPENAI"
const GEMINI_MODEL = "gemini-2.5-flash-lite-preview-06-17"; // Google Gemini model to use
const GEMINI_API_KEY = "PASTE_YOUR_GEMINI_API_KEY_HERE"; // Your Gemini API key
const OPENAI_API_KEY = "PASTE_YOUR_OPENAI_API_KEY_HERE"; // Your OpenAI API key (if using OPENAI)
const OPENAI_MODEL = "gpt-4.1-nano";                // OpenAI model to use

/**
 * -----------------------------------------------------------------------------
 * SETUP & TRIGGER FUNCTIONS
 * -----------------------------------------------------------------------------
 */

function SETUP_SCRIPT_AND_AUTHORIZE() {
  Logger.log("--- Starting Full Script Setup ---");
  MANUALLY_SET_API_KEY();
  MANUALLY_SET_OPENAI_API_KEY();
  createFileProcessingTrigger();
  createCacheTrigger();
  Logger.log("--- Starting initial folder scan. This may take several chained executions to complete... ---");
  startFolderScan();
  Logger.log("--- Script Setup Complete ---");
}

function MANUALLY_SET_API_KEY() {
  if (GEMINI_API_KEY === "PASTE_YOUR_GEMINI_API_KEY_HERE" || !GEMINI_API_KEY) {
    Logger.log("API Key not provided. Please update the GEMINI_API_KEY constant and run SETUP_SCRIPT_AND_AUTHORIZE again.");
    return;
  }
  try {
    PropertiesService.getUserProperties().setProperty('GEMINI_API_KEY', GEMINI_API_KEY);
    Logger.log(`Success: API Key saved.`);
  } catch (e) {
    Logger.log(`Error saving API key: ${e.toString()}`);
  }
}

/**
 * Creates the time-based trigger for processing files every 10 minutes.
 */
function MANUALLY_SET_OPENAI_API_KEY() {
  if (OPENAI_API_KEY === "PASTE_YOUR_OPENAI_API_KEY_HERE" || !OPENAI_API_KEY) {
    Logger.log("OpenAI API Key not provided. Please update the OPENAI_API_KEY constant and run SETUP_SCRIPT_AND_AUTHORIZE again.");
    return;
  }
  try {
    PropertiesService.getUserProperties().setProperty('OPENAI_API_KEY', OPENAI_API_KEY);
    Logger.log(`Success: OpenAI API Key saved.`);
  } catch (e) {
    Logger.log(`Error saving OpenAI API key: ${e.toString()}`);
  }
}

function createFileProcessingTrigger() {
  _createMinuteTrigger('scanFolderAndProcessFiles', 10);
}

/**
 * Creates the time-based trigger for caching the folder structure every 6 hours.
 */
function createCacheTrigger() {
  const functionName = 'startFolderScan';
  _deleteTrigger(functionName);

  const triggerBuilder = ScriptApp.newTrigger(functionName).timeBased();
  const userTimezone = Session.getScriptTimeZone();

  // Use everyDays() for intervals of 24 hours or more that are clean multiples of 24.
  if (FOLDER_CACHE_REFRESH_HOURS >= 24 && FOLDER_CACHE_REFRESH_HOURS % 24 === 0) {
    const days = FOLDER_CACHE_REFRESH_HOURS / 24;
    triggerBuilder.everyDays(days).atHour(0); // Run at midnight in user's timezone
    Logger.log(`Success: Trigger for '${functionName}' has been created to run every ${days} day(s) at midnight (${userTimezone}).`);
  } else {
    triggerBuilder.everyHours(FOLDER_CACHE_REFRESH_HOURS);
    Logger.log(`Success: Trigger for '${functionName}' has been created to run every ${FOLDER_CACHE_REFRESH_HOURS} hours.`);
  }
  
  triggerBuilder.create();
}

/**
 * -----------------------------------------------------------------------------
 * DEBUGGING & MANUAL RESET FUNCTIONS
 * -----------------------------------------------------------------------------
 */

/**
 * Debug function to check current scan state - run this if scans seem stuck
 */
function DEBUG_CHECK_SCAN_STATE() {
  const properties = PropertiesService.getScriptProperties();
  const scanInProgress = properties.getProperty('scanState_inProgress');
  const scanStartTime = properties.getProperty('scanState_startTime');
  const tempTriggerId = properties.getProperty('scanState_tempTriggerId');
  const folderStack = properties.getProperty('scanState_folderStack');
  const foundPaths = properties.getProperty('scanState_foundPaths');
  const folderCache = properties.getProperty('folderCache');
  const cacheTimestamp = properties.getProperty('folderCacheTimestamp');
  
  Logger.log('=== SCAN STATE DEBUG INFO ===');
  Logger.log(`Scan in progress: ${scanInProgress}`);
  
  if (scanStartTime) {
    const startTime = new Date(parseInt(scanStartTime));
    const elapsedMinutes = Math.round((new Date().getTime() - parseInt(scanStartTime)) / (1000 * 60));
    Logger.log(`Scan start time: ${startTime.toLocaleString()} (${elapsedMinutes} minutes ago)`);
  }
  
  Logger.log(`Continuation trigger ID: ${tempTriggerId || 'None'}`);
  
  if (folderStack) {
    const stack = JSON.parse(folderStack);
    Logger.log(`Folders remaining in stack: ${stack.length}`);
  }
  
  if (foundPaths) {
    const paths = JSON.parse(foundPaths);
    Logger.log(`Paths found so far: ${paths.length}`);
  }
  
  Logger.log(`Cached folders: ${folderCache ? JSON.parse(folderCache).length : 'No cache'}`);
  Logger.log(`Cache timestamp: ${cacheTimestamp || 'No timestamp'}`);
  
  // Check for active triggers
  const activeTriggers = ScriptApp.getProjectTriggers();
  Logger.log(`Active triggers: ${activeTriggers.length}`);
  activeTriggers.forEach(trigger => {
    Logger.log(`  - ${trigger.getHandlerFunction()} (${trigger.getEventType()}) - ID: ${trigger.getUniqueId()}`);
  });
  
  Logger.log('=== END DEBUG INFO ===');
}

/**
 * Manual reset function - use this if scan state gets stuck
 */
function MANUAL_RESET_SCAN_STATE() {
  const properties = PropertiesService.getScriptProperties();
  
  Logger.log('Manually resetting scan state...');
  
  // Clean up all scan-related properties
  properties.deleteProperty('scanState_inProgress');
  properties.deleteProperty('scanState_startTime');
  properties.deleteProperty('scanState_folderStack');
  properties.deleteProperty('scanState_foundPaths');
  properties.deleteProperty('scanState_tempTriggerId');
  
  // Clean up any continuation triggers
  _deleteContinuationTrigger();
  
  // Also clean up any stray continuation triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'continueFolderScan') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log(`Deleted stray continuation trigger: ${trigger.getUniqueId()}`);
    }
  });
  
  Logger.log('Scan state reset complete. File processing should resume on next trigger.');
}

/**
 * -----------------------------------------------------------------------------
 * STATEFUL FOLDER CACHING (CHAINED EXECUTION)
 * -----------------------------------------------------------------------------
 */

/**
 * Initiates a new folder structure scan. Deletes any previous state.
 * This function is run by a time-based trigger every 6 hours.
 */
function startFolderScan() {
  _deleteContinuationTrigger(); // Clean up any old triggers that may have failed.
  const properties = PropertiesService.getScriptProperties();
  properties.setProperties({
    'scanState_folderStack': JSON.stringify([DriveApp.getRootFolder().getId()]),
    'scanState_foundPaths': JSON.stringify([]),
    'scanState_inProgress': 'true',
    'scanState_startTime': new Date().getTime().toString()
  }, true);
  Logger.log("Folder scan started. Kicking off first continuation.");
  continueFolderScan();
}

/**
 * Processes a chunk of the folder structure. If time runs out, it creates a new trigger
 * to call itself again and continue the work.
 */
function continueFolderScan() {
  const startTime = new Date();
  const properties = PropertiesService.getScriptProperties();
  
  try {
    let folderStack = JSON.parse(properties.getProperty('scanState_folderStack'));
    let foundPaths = JSON.parse(properties.getProperty('scanState_foundPaths'));
    let foldersProcessed = 0;

    while (folderStack.length > 0) {
      const folderId = folderStack.pop();
      const parentFolder = DriveApp.getFolderById(folderId);
      const currentPath = _getFolderPath(parentFolder);
      
      // Check if this folder is blacklisted
      if (_isFolderBlacklisted(parentFolder, currentPath)) {
        // Skip this folder and all its children
        Logger.log(`Skipping blacklisted folder: ${currentPath}`);
        foldersProcessed++;
        continue;
      }
      
      if (currentPath && currentPath !== "/") {
          foundPaths.push(currentPath);
      }

      const childFolders = parentFolder.getFolders();
      while (childFolders.hasNext()) {
        const child = childFolders.next();
        if (child.getName() !== SOURCE_FOLDER_NAME && !child.getName().startsWith('.')) {
          folderStack.push(child.getId());
        }
      }

      foldersProcessed++;
      
      // Check time limit only after processing a batch of folders (more efficient)
      if (foldersProcessed >= FOLDER_BATCH_SIZE) {
        const elapsedTime = (new Date() - startTime) / 1000;
        if (elapsedTime > MAX_RUNTIME_SECONDS) {
          properties.setProperty('scanState_folderStack', JSON.stringify(folderStack));
          properties.setProperty('scanState_foundPaths', JSON.stringify(foundPaths));
          _createContinuationTrigger();
          Logger.log(`Scan paused due to time limit. Processed ${foldersProcessed} folders this run, ${folderStack.length} remain.`);
          return;
        }
        foldersProcessed = 0; // Reset batch counter
      }
    }

    // If the loop completes, the scan is finished.
    properties.setProperty('folderCache', JSON.stringify(foundPaths));
    properties.setProperty('folderCacheTimestamp', new Date().toUTCString());
    properties.deleteProperty('scanState_inProgress'); // Mark scan as complete
    properties.deleteProperty('scanState_startTime');
    properties.deleteProperty('scanState_tempTriggerId');
    _deleteContinuationTrigger();
    Logger.log(`Folder scan complete. Successfully cached ${foundPaths.length} folders.`);

  } catch (e) {
    Logger.log(`Error during continueFolderScan: ${e.toString()}.`);
    properties.deleteProperty('scanState_inProgress');
    properties.deleteProperty('scanState_startTime');
    properties.deleteProperty('scanState_tempTriggerId');
    _deleteContinuationTrigger();
  }
}

/**
 * -----------------------------------------------------------------------------
 * MAIN FILE PROCESSING (RUNS EVERY 10 MINUTES)
 * -----------------------------------------------------------------------------
 */

function scanFolderAndProcessFiles() {
  const properties = PropertiesService.getScriptProperties();
  const scanInProgress = properties.getProperty('scanState_inProgress');
  
  if (scanInProgress === 'true') {
    // Check if scan might be stuck (no continuation trigger activity for 30+ minutes)
    const scanStartTime = properties.getProperty('scanState_startTime');
    const currentTime = new Date().getTime();
    const thirtyMinutes = 30 * 60 * 1000;
    
    if (scanStartTime && (currentTime - parseInt(scanStartTime)) > thirtyMinutes) {
      // Check if there are any continuation triggers still active
      const tempTriggerId = properties.getProperty('scanState_tempTriggerId');
      let activeTriggerFound = false;
      
      if (tempTriggerId) {
        ScriptApp.getProjectTriggers().forEach(trigger => {
          if (trigger.getUniqueId() === tempTriggerId) {
            activeTriggerFound = true;
          }
        });
      }
      
      if (!activeTriggerFound) {
        Logger.log("Warning: Scan appears stuck (30+ minutes, no active continuation trigger). Resetting scan state.");
        properties.deleteProperty('scanState_inProgress');
        properties.deleteProperty('scanState_startTime');
        properties.deleteProperty('scanState_tempTriggerId');
        // Continue with file processing
      } else {
        Logger.log("Folder scan is in progress with active continuation trigger. Skipping file processing.");
        return;
      }
    } else {
      Logger.log("Folder scan is currently in progress. Skipping file processing run to use complete data later.");
      return;
    }
  }

  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(100);
    if (!lockAcquired) {
      Logger.log("Could not acquire lock, another instance is likely running. Exiting.");
      return;
    }
    
    Logger.log("Lock acquired successfully. Starting file processing.");

    const sourceFolder = _getSourceFolder();
    if (!sourceFolder) {
      Logger.log("Source folder not found. Exiting.");
      return;
    }

    const files = sourceFolder.getFiles();
    if (!files.hasNext()) {
      Logger.log("No files found in source folder. Exiting.");
      return;
    }

    const folderListString = PropertiesService.getScriptProperties().getProperty('folderCache');
    if (!folderListString) {
      Logger.log("Folder cache is empty. Please run 'SETUP_SCRIPT_AND_AUTHORIZE' or wait for the scan to complete.");
      return;
    }
    
    // Track processing time and errors
    const startTime = new Date().getTime();
    let processedCount = 0;
    let errorCount = 0;
    
    while (files.hasNext() && processedCount < BATCH_SIZE) {
      try {
        const file = files.next();
        _organizeFile(file, folderListString);
        processedCount++;
        
        // Force small pause between files to avoid rate limits
        if (files.hasNext() && processedCount < BATCH_SIZE) {
          Utilities.sleep(100);
        }
      } catch (fileError) {
        errorCount++;
        Logger.log(`Error in file processing loop: ${fileError}`);
        // Continue to next file
      }
    }
    
    const elapsedTime = (new Date().getTime() - startTime) / 1000;
    Logger.log(`Processing complete for this batch. ${processedCount} file(s) were organized in ${elapsedTime.toFixed(2)} seconds. Errors: ${errorCount}`);

  } catch (e) {
    Logger.log(`Critical error during scan and process run: ${e.toString()}`);
    if (e.stack) {
      Logger.log(`Stack trace: ${e.stack}`);
    }
  } finally {
    if (lockAcquired) {
      try {
        lock.releaseLock();
        Logger.log("Lock released successfully.");
      } catch (lockError) {
        Logger.log(`Error releasing lock: ${lockError}`);
      }
    }
  }
}

/**
 * -----------------------------------------------------------------------------
 * HELPER & CORE LOGIC FUNCTIONS
 * -----------------------------------------------------------------------------
 */

/**
 * Organizes a file using Gemini AI to suggest a better filename and destination folder.
 * Supports two methods based on file size:
 * 1. Inline base64 content for files under INLINE_FILE_SIZE_LIMIT_MB (faster)
 * 2. Gemini Files API for larger files up to MAX_FILE_SIZE_LIMIT_MB
 * 
 * @param {File} file - The Google Drive file to organize
 * @param {string} folderListString - JSON string of available folders
 */
function _organizeFile(file, folderListString) {
  const fileId = file.getId();
  try {
    // Check file size against maximum limit
    const fileSize = file.getSize();
    const fileSizeMB = Math.round(fileSize/1024/1024 * 10) / 10; // Round to 1 decimal place
    
    if (fileSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
      Logger.log(`File ${file.getName()} is too large (${fileSizeMB}MB). Maximum size is ${MAX_FILE_SIZE_MB}MB. Skipping.`);
      return;
    }
    
    // Use stored API key (not the constant, in case it was changed after setup)
    let apiKey;
    if (AI_PLATFORM === "GEMINI") {
      apiKey = PropertiesService.getUserProperties().getProperty('GEMINI_API_KEY');
    } else if (AI_PLATFORM === "OPENAI") {
      apiKey = PropertiesService.getUserProperties().getProperty('OPENAI_API_KEY');
    } else {
      throw new Error(`Unsupported AI_PLATFORM: ${AI_PLATFORM}`);
    }
    if (!apiKey) throw new Error("API key not found. Please run SETUP_SCRIPT_AND_AUTHORIZE first.");

    // Rate limiting
    const properties = PropertiesService.getScriptProperties();
    const lastApiCallTime = parseInt(properties.getProperty('lastApiCallTime') || '0');
    const MIN_API_CALL_SPACING_MS = 500; // Adjust as needed
    
    if (new Date().getTime() - lastApiCallTime < MIN_API_CALL_SPACING_MS) {
      Utilities.sleep(MIN_API_CALL_SPACING_MS);
    }
    
    let fileBlob, bytes, base64Data;
    try {
      fileBlob = file.getBlob();
      bytes = fileBlob.getBytes();
      base64Data = Utilities.base64Encode(bytes);
    } catch (blobError) {
      Logger.log(`Error getting file content for ${file.getName()}: ${blobError}. Skipping.`);
      return;
    }
    
    const mimeType = fileBlob.getContentType();
    const originalFilename = file.getName();
    
    const prompt = `Analyze the content of the attached file (MIME type: ${mimeType}). The original filename is "${originalFilename}".

TASKS:
1. Suggest a concise, human-friendly filename. • Include a date only if the file itself clearly contains a meaningful date that will help users identify it. • If no useful date is present or it adds no value, omit the date. • Never invent a date.
2. From the list of folders, pick the single most appropriate destination path.

Available Folders: ${folderListString}

Respond ONLY with a minified JSON object using exact keys "newFilename" and "destinationFolder".`;
    
        let response;
    if (AI_PLATFORM === "GEMINI") {
      const requestBody = { "contents": [{ "parts": [{ "text": prompt }, { "inline_data": { "mime_type": mimeType, "data": base64Data } }] }] };
      const requestOptions = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(requestBody), 'muteHttpExceptions': true };
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
      response = UrlFetchApp.fetch(apiUrl, requestOptions);
    } else if (AI_PLATFORM === "OPENAI") {
      const chatRequest = {
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: `${prompt}\n\n[BASE64_ENCODED_FILE_CONTENT]\n${base64Data}` }]
      };
      const requestOptions = {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${apiKey}` },
        payload: JSON.stringify(chatRequest),
        muteHttpExceptions: true
      };
      const apiUrl = "https://api.openai.com/v1/chat/completions";
      response = UrlFetchApp.fetch(apiUrl, requestOptions);
    } else {
      throw new Error(`Unsupported AI_PLATFORM: ${AI_PLATFORM}`);
    }
    properties.setProperty('lastApiCallTime', new Date().getTime().toString());
    
    const responseCode = response.getResponseCode();
    Logger.log(`API response code: ${responseCode}`);
    
    if (responseCode !== 200) {
      const errorText = response.getContentText();
      Logger.log(`API error response: ${errorText.substring(0, 200)}...`);
      throw new Error(`API call failed with status ${responseCode}`);
    }

    const responseText = response.getContentText();
    Logger.log(`Response snippet: ${responseText.substring(0, 100)}...`);
    
        // Parse response with better error handling
    let jsonResponse, resultText, result;
    try {
      jsonResponse = JSON.parse(responseText);

      if (AI_PLATFORM === "GEMINI") {
        if (!jsonResponse.candidates || 
            !jsonResponse.candidates[0] || 
            !jsonResponse.candidates[0].content || 
            !jsonResponse.candidates[0].content.parts || 
            !jsonResponse.candidates[0].content.parts[0] || 
            !jsonResponse.candidates[0].content.parts[0].text) {
          throw new Error(`Invalid response structure: ${JSON.stringify(jsonResponse).substring(0, 200)}...`);
        }
        resultText = jsonResponse.candidates[0].content.parts[0].text;
      } else if (AI_PLATFORM === "OPENAI") {
        if (!jsonResponse.choices || !jsonResponse.choices[0] || !jsonResponse.choices[0].message || !jsonResponse.choices[0].message.content) {
          throw new Error(`Invalid response structure from OpenAI: ${JSON.stringify(jsonResponse).substring(0,200)}...`);
        }
        resultText = jsonResponse.choices[0].message.content;
      } else {
        throw new Error(`Unsupported AI_PLATFORM: ${AI_PLATFORM}`);
      }

      const cleanedJsonString = resultText.replace(/```json|```/g, '').trim();
      result = JSON.parse(cleanedJsonString);

      if (!result.newFilename || !result.destinationFolder) {
        throw new Error(`Missing required fields in response: ${cleanedJsonString.substring(0, 100)}...`);
      }
    } catch (jsonError) {
      Logger.log(`JSON parsing error: ${jsonError}. Raw response: ${resultText ? resultText.substring(0, 200) : 'undefined'}...`);
      // Provide fallback values
      result = {
        newFilename: originalFilename,
        destinationFolder: "/Unprocessed Files"
      };
      Logger.log(`Using fallback values: ${JSON.stringify(result)}`);
    }

    // Move file to appropriate folder
    try {
      // First check if this path exists as-is in our folder cache
      const folderCache = JSON.parse(PropertiesService.getScriptProperties().getProperty('folderCache') || '[]');
      const destinationExists = folderCache.some(path => path === result.destinationFolder);
      
      if (!destinationExists) {
        Logger.log(`Warning: Folder path "${result.destinationFolder}" not found in folder cache. ` +
                  `Will check if it exists in Drive...`);
        
        // Try to find the folder by navigating the path
        const pathParts = result.destinationFolder.split('/').filter(p => p);
        let targetFolder = DriveApp.getRootFolder();
        let folderExists = true;
        
        for (const part of pathParts) {
          const folders = targetFolder.getFoldersByName(part);
          if (folders.hasNext()) {
            targetFolder = folders.next();
          } else {
            folderExists = false;
            break;
          }
        }
        
        if (!folderExists) {
          Logger.log(`Destination path "${result.destinationFolder}" does not exist. ` + 
                    `Triggering folder rescan. File will remain in "${SOURCE_FOLDER_NAME}" for now.`);
          
          // Schedule a folder rescan
          startFolderScan();
          
          // Skip processing this file - leave it in the source folder
          // It will be processed again after the folder scan completes
          return;
        } else {
          Logger.log(`Folder exists in Drive but was missing from cache. Using existing folder.`);
        }
      }
      
      // At this point, either the folder exists in our cache or we confirmed it exists in Drive
      const pathParts = result.destinationFolder.split('/').filter(p => p);
      let targetFolder = DriveApp.getRootFolder();
      for (const part of pathParts) {
        const folders = targetFolder.getFoldersByName(part);
        targetFolder = folders.hasNext() ? folders.next() : targetFolder.createFolder(part);
      }

      file.setName(result.newFilename);
      file.moveTo(targetFolder);
      Logger.log(`File '${file.getName()}' moved to '${result.destinationFolder}'.`);
    } catch (moveError) {
      Logger.log(`Error moving file: ${moveError}. File was not moved.`);
    }

  } catch (e) {
    Logger.log(`Error processing file ${file.getName()} (ID: ${fileId}): ${e.toString()}`);
    if (e.stack) {
      Logger.log(`Stack trace: ${e.stack}`);
    }
  }
}

function _createMinuteTrigger(functionName, minutes) {
  _deleteTrigger(functionName);
  ScriptApp.newTrigger(functionName).timeBased().everyMinutes(minutes).create();
  Logger.log(`Success: Trigger for '${functionName}' created to run every ${minutes} minutes.`);
}

function _createContinuationTrigger() {
  _deleteContinuationTrigger(); // Ensure no duplicates
  const trigger = ScriptApp.newTrigger('continueFolderScan').timeBased().after(60 * 1000).create();
  PropertiesService.getScriptProperties().setProperty('scanState_tempTriggerId', trigger.getUniqueId());
}

function _deleteContinuationTrigger() {
  const properties = PropertiesService.getScriptProperties();
  const triggerId = properties.getProperty('scanState_tempTriggerId');
  if (triggerId) {
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getUniqueId() === triggerId) {
        ScriptApp.deleteTrigger(trigger);
        properties.deleteProperty('scanState_tempTriggerId');
      }
    });
  }
}

function _deleteTrigger(functionName) {
    ScriptApp.getProjectTriggers().forEach(trigger => {
        if (trigger.getHandlerFunction() === functionName) {
            ScriptApp.deleteTrigger(trigger);
            Logger.log(`An old trigger for '${functionName}' was found and deleted.`);
        }
    });
}

function _getSourceFolder() {
    const folders = DriveApp.getFoldersByName(SOURCE_FOLDER_NAME);
    return folders.hasNext() ? folders.next() : null;
}

function _getFolderPath(folder) {
    if (!folder) return null;
    let path = [];
    let current = folder;
    while (current.getParents().hasNext()) {
        const parent = current.getParents().next();
        path.unshift(current.getName());
        current = parent;
    }
    return `/${path.join('/')}`;
}

/**
 * Checks if a folder should be blacklisted based on the BLACKLISTED_PATHS configuration.
 * Supports both simple folder names and full paths from root.
 * @param {Folder} folder - The Google Drive folder to check
 * @param {string} folderPath - The full path of the folder (optional, will be computed if not provided)
 * @returns {boolean} - True if the folder should be excluded
 */
function _isFolderBlacklisted(folder, folderPath) {
    if (BLACKLISTED_PATHS.length === 0) return false;
    
    const folderName = folder.getName();
    const fullPath = folderPath || _getFolderPath(folder);
    
    // Remove leading slash for comparison
    const cleanPath = fullPath ? fullPath.substring(1) : '';
    
    for (const blacklistedItem of BLACKLISTED_PATHS) {
        // Check if it's a simple folder name match
        if (folderName === blacklistedItem) {
            return true;
        }
        
        // Check if it's a full path match (exact match or starts with blacklisted path)
        if (cleanPath === blacklistedItem || cleanPath.startsWith(blacklistedItem + '/')) {
            return true;
        }
    }
    
    return false;
}
