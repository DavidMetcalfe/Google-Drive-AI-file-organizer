# Gemini File Organizer for Google Drive

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful Google Apps Script that automatically organizes files in your Google Drive using Google's Gemini AI. The script analyzes file content and intelligently suggests appropriate filenames and destination folders.

## 🌟 Features

- **AI-Powered Organization**: Uses Gemini 2.5 Flash Lite to understand file content and suggest optimal organization
- **Smart Folder Structure**: Intelligently renames files and moves them to appropriate folders
- **Optimized File Handling**: Processes files up to 18MB with efficient inline processing
- **Scalable Architecture**: Works with any size Google Drive through stateful processing and chained execution
- **Configurable Workflows**: Customizable settings for processing frequency, batch sizes, and folder refresh intervals
- **Robust Error Handling**: Built-in protections against file size limits, API errors, and concurrent execution issues

## ⚙️ How It Works

The script operates through two main processes:

1. **Folder Scanning**: A stateful, chained execution process that builds a complete cache of your folder structure while respecting Google's runtime limits.
2. **File Processing**: A frequent batch process that analyzes files in your designated source folder and moves them to appropriate destinations.

### The Workflow

```
┌────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│                │         │                  │         │                 │
│  Drop files in │         │ Gemini analyzes  │         │  Files moved to │
│ "Scanned      ◄─────────► content & suggests├────────►  appropriate     │
│  content"      │         │ organization     │         │  folders        │
│                │         │                  │         │                 │
└────────────────┘         └──────────────────┘         └─────────────────┘
```

## 📋 Requirements

- Google account with Google Drive access
- Google Apps Script editor
- Gemini API key (from Google AI Studio or Google Cloud)

## 🚀 Installation

1. **Create a New Apps Script Project**:
   - Go to [script.google.com](https://script.google.com/)
   - Create a new project
   - Delete any code in the editor

2. **Add the Code**:
   - Copy the entire content from `Gemini File Organizer Apps Script.js`
   - Paste it into your Apps Script editor
   - Save the project (give it a name like "Gemini File Organizer")

3. **Create Source Folder**:
   - Create a folder in your Google Drive named "Scanned content" (or change the `SOURCE_FOLDER_NAME` constant if you prefer a different name)

## ⚙️ Configuration

Adjust these settings in the "Global Configuration" section at the top of the script:

```javascript
// --- Global Configuration ---
const SOURCE_FOLDER_NAME = "Scanned content";  // Where you'll drop files to organize
const BATCH_SIZE = 5;                          // Files processed per run
const MAX_RUNTIME_SECONDS = 240;               // Seconds before chaining folder scan
const FOLDER_CACHE_REFRESH_HOURS = 24;         // How often to refresh folder structure

// --- File Size Configuration ---
const MAX_FILE_SIZE_MB = 18;                   // Maximum file size for processing

// --- API Configuration ---
const GEMINI_API_KEY = "PASTE_YOUR_GEMINI_API_KEY_HERE"; // Your Gemini API key
```

## 🔧 Setup

1. **Get a Gemini API Key**:
   - Go to [Google AI Studio](https://aistudio.google.com/) or [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project
   - Enable the Gemini API
   - Create an API key

2. **Configure the Script**:
   - Add your Gemini API key to the `GEMINI_API_KEY` constant
   - Review and adjust the other configuration settings if needed

3. **Run Setup**:
   - In the Apps Script editor, select the `SETUP_SCRIPT_AND_AUTHORIZE` function from the dropdown menu
   - Click the "Run" button ▶️
   - Grant the necessary permissions when prompted
   - Wait for setup to complete (check the Execution log for progress)

## 🎮 Usage

Once configured, the script runs automatically:

1. **Drop Files**: Place any files you want to organize into the "Scanned content" folder (or your custom named folder)
2. **Automatic Processing**: Files are processed in batches every 10 minutes
3. **Organized Results**: Files will be renamed and moved to appropriate folders based on their content

## 📊 Advanced Features

### Custom Folder Refresh Intervals

You can set longer intervals for folder structure rescanning by adjusting the `FOLDER_CACHE_REFRESH_HOURS` constant:
- Set to `24` for daily refresh (default)
- Set to `168` for weekly refresh
- Any multiple of 24 will use the more efficient `everyDays()` trigger

### File Size Limits

The script processes files up to 18MB in size, which approaches Gemini's 20MB inline data limit while providing a safety margin for encoding overhead.

You can adjust this limit by modifying the following constant:

```javascript
// --- File Size Configuration ---
const MAX_FILE_SIZE_MB = 18;                  // Maximum file size in MB
```

Files larger than this limit will be skipped with an appropriate log message.

### Smart Path Validation

The script validates destination paths before moving files, ensuring that if a suggested folder doesn't exist:
1. It triggers a folder rescan
2. Leaves the file in the source folder for later processing

## 🐛 Troubleshooting

### Common Issues

1. **"API key not found" error**: 
   - Ensure you've run the `SETUP_SCRIPT_AND_AUTHORIZE` function
   - Check that your API key is correctly set in the `GEMINI_API_KEY` constant

2. **Files not being processed**:
   - Check the Apps Script execution logs for errors
   - Verify that the source folder exists with the correct name
   - Ensure triggers are created (check under Edit → Current project's triggers)

3. **Files stuck in source folder**:
   - Wait for the folder scan to complete (especially on first run)
   - Check logs for API errors or rate limiting issues

### Execution Logs

To view logs and diagnose issues:
1. In the Apps Script editor, click on "Executions" in the left sidebar
2. Select recent executions to view their logs

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

## 🙏 Acknowledgements

- Google for the Gemini API
- Google Apps Script for enabling powerful automation
