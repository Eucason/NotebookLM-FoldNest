# NotebookLM FoldNest

A Chrome extension that transforms Google's NotebookLM into a comprehensive project management platform with hierarchical organization, advanced task management, and multi-window workflows.

---

## ⚠️ Critical Information

### Data Storage & Backup

**Local Storage Architecture**: This extension uses Chrome's local storage for maximum performance and privacy. All your data (folders, tasks, mappings, and search indices) is stored exclusively on your device.

**Important Consequences**:
- Uninstalling the extension **immediately deletes all data**
- Clearing Chrome's site data or cookies will erase your configuration
- Data does not automatically sync between devices (unless you enable optional Cloud Sync)

**Solution**: Always use the **Export** button to create JSON backups before:
- Uninstalling or updating the extension
- Switching computers or browsers
- Clearing browser data
- Making major organizational changes

### Google Updates & Reliability

This extension operates by interacting with NotebookLM's web interface. If Google updates their website structure, certain features may temporarily break.

**Disclaimer**: As a free, open-source project maintained by a medical student, I cannot guarantee immediate fixes following Google's updates. Always maintain backups of critical work using NotebookLM's native export features.

---

## 🎯 Project Status

**Developer Note**: I am a Medicine & Surgery student, not a professional software developer. This tool was built to solve my own organizational challenges with NotebookLM and is shared freely with the community.

**Current Version**: v0.9.3 - Stable for personal use, but may contain edge cases not encountered in my workflow.

**Support**: Bug reports and feature requests are welcome via GitHub Issues. Response times may vary based on academic commitments.

---

## 🚀 What's New in v0.9.3

### Dashboard Organization System
- **Folder Hierarchy**: Create nested folder structures to organize your notebooks on the dashboard
- **Grid & List View Support**: Full integration with both NotebookLM view modes
- **Smart Hiding**: Notebooks assigned to folders are automatically hidden from the main grid to reduce clutter
- **Visual Theming**: Color-code folders for instant visual categorization

### Enhanced Stability
- **Graceful Degradation**: Individual features disable themselves if errors occur, preventing total extension failure
- **Improved DOM Observers**: More resilient to Google's interface changes
- **Cloud Sync** (Optional): Cross-device synchronization via Google Drive AppData

### UI Improvements
- **Collapsible Sidebar**: Resizable sidebar with smooth animations and proper content reflow
- **Responsive Design**: Optimized for both desktop and mobile viewports
- **Dark Mode Support**: Seamless integration with NotebookLM's theme switching

---

## 📋 Complete Feature Set

### Dashboard View Features

The Dashboard View provides notebook-level organization across your entire NotebookLM workspace.

#### Folder Management
- **Nested Folder Structure**: Create unlimited levels of subfolders to match your project taxonomy
- **Drag-Free Reordering**: Use up/down arrow buttons to reorganize folder hierarchy
- **Color Coding**: Assign visual themes to folders (8 color palette options)
- **Expand/Collapse Controls**: 
  - Click folder headers to toggle individual folders
  - "Expand All" / "Collapse All" buttons for bulk operations
  - Obsidian-style unfold icons for intuitive navigation

#### Notebook Organization
- **Grid View Integration**:
  - Hover over any notebook card to reveal "Add to Folder" button
  - Click to open folder selection menu
  - Notebooks in folders are hidden from main grid to reduce visual clutter
  
- **List View Compatibility**:
  - Full feature parity with grid view
  - "Add to Folder" button appears in actions column
  - Maintains NotebookLM's native list view for users who prefer tabular layouts

- **Intelligent Proxy System**:
  - Notebooks appear as proxy items inside folder containers
  - Click proxy to open the notebook
  - Eject button to remove notebook from folder (restores to main grid)
  - Proxies persist during folder collapse/expand without DOM regeneration

#### Search & Filtering
- **Real-Time Search**: Filter notebooks by title across all folders
- **Debounced Input**: 300ms delay prevents performance issues during typing
- **Clear Button**: One-click search reset with visual feedback

#### Data Management
- **Export Configuration**:
  - JSON export includes all folders, mappings, settings, and metadata
  - Timestamped backup files for version control
  - File naming: `notebooklm-dashboard-folders.json`

- **Import Configuration**:
  - Restore complete dashboard state from backup
  - Confirmation modal prevents accidental overwrites
  - **Important**: Refresh page after import to see changes

- **Reset Function**:
  - Nuclear option to clear all dashboard folders
  - Confirmation modal with clear warning
  - Does not affect individual notebook data

#### Cloud Sync (Optional)
- **Google Drive Integration**:
  - Enable/disable toggle in sync menu
  - OAuth authentication via Chrome identity API
  - Stores data in Google Drive's AppData folder (private to extension)
  
- **Automatic Synchronization**:
  - Debounced uploads (2s delay after last change)
  - Manual sync trigger available
  - Last sync timestamp display
  
- **Conflict Resolution**:
  - Timestamp-based last-write-wins strategy
  - Downloads remote state on extension load
  - Uploads local changes after modifications
  
- **Status Indicator**:
  - Visual feedback: idle (gray), syncing (blue), success (green), error (red)
  - Error messages for authentication failures
  - Sync menu with "Enable/Disable Sync" and "Sync Now" options

---

### Notebook View Features

The Notebook View operates within individual notebooks, providing granular organization for sources, notes, and generated content.

#### Hierarchical Organization
- **Dual-Context Folders**:
  - **Source Panel**: Organize research materials, PDFs, web links
  - **Studio Panel**: Categorize notes, generated audio, FAQs, study guides
  
- **Nested Structure**: Unlimited folder depth with parent-child relationships
- **Visual Indicators**:
  - Expand/collapse arrows for folder state
  - Indent levels for visual hierarchy
  - Color borders for quick identification

#### Item Management
- **Drag-Free Moving**:
  - Three-dot menu on each item
  - Folder selection dropdown
  - Move between folders or back to uncategorized
  
- **Pinning System**:
  - Pin critical items to top of lists
  - Pin icon changes state (outline → filled)
  - Works across both source and studio panels
  
- **Bulk Selection**:
  - Master checkbox in Source panel toggles all sources
  - Folder-level checkboxes select all items in that folder
  - Syncs with NotebookLM's native selection for AI context

#### Advanced Task Management
- **Task Creation**:
  - Manual creation via "New Task" button
  - Quick capture: Select text in any note → floating "+" button appears
  - Auto-populated fields: title (truncated), description (full text), source note reference
  
- **Task Sections**:
  - Create custom sections to group related tasks (e.g., "Research", "Writing", "Review")
  - Collapsible sections with color coding
  - Reorder sections with up/down buttons
  - Move tasks between sections via dropdown menu
  
- **Task Properties**:
  - **Priority Flags**: Red (high), yellow (medium), blue (low)
  - **Due Dates**: Date picker with quick actions ("Today", "Tomorrow", "+1 Week")
  - **Descriptions**: Rich text field for context, notes, or instructions
  - **Source Links**: Tasks created from notes include clickable link icon
    - Blue icon indicates linked task
    - Click to filter Studio panel to source note
  
- **Task Organization**:
  - Sort by priority or due date
  - Completed tasks move to dedicated "Completed Tasks" section
  - Section-specific active/completed task counts
  - Expand/collapse completed tasks section

#### Search & Indexing
- **Content Indexing**:
  - Automatic indexing when you open/view a note
  - Indexes actual note content, not just titles
  - LZ-String compression for efficient storage
  
- **Search Capabilities**:
  - Fuzzy matching algorithm (65% similarity threshold)
  - Searches across all indexed notes in current notebook
  - Highlights matching notes with similarity scores
  - Folder-aware search results
  
- **Index Management**:
  - Size limit: 2MB per notebook
  - LRU (Least Recently Used) eviction when limit exceeded
  - Manual rebuild via settings menu
  - Statistics display (indexed notes count, storage used)

#### Focus & Productivity
- **Zen Mode**:
  - Toggle via meditation pose icon
  - Hides AI chat panel and right sidebars
  - Maximizes screen space for reading/writing
  - Preserves state across sessions
  
- **Multi-Window Workflow**:
  - Pop-out any note into separate browser window
  - Read-only formatted view with full styling preservation
  - Copy-to-clipboard functionality
  - Dark/light theme sync with main window
  - Positions new windows automatically (right side of screen)
  - Track multiple pop-outs simultaneously

#### Visual Customization
- **Folder Colors**:
  - 8-color palette (blue, green, red, yellow, purple, cyan, orange, teal)
  - Click palette icon to open color picker
  - Colors apply to folder borders and icons
  - Clear color option to reset to default
  
- **Icons & Indicators**:
  - Standardized Google Material Icons
  - Context-aware icon states (hover, active, disabled)
  - Consistent sizing (12px-24px range)

#### Data Portability
- **Export**:
  - Exports current notebook's complete state
  - Includes: folders, mappings, tasks, task sections, settings
  - File naming: `notebooklm-pro-{notebookId}.json`
  
- **Import**:
  - Restore from backup JSON file
  - Confirmation modal prevents data loss
  - Reloads page automatically after import

---

## 🛠️ Installation

### Method 1: Load Unpacked (Developer Mode)

1. **Download the Extension**:
   - Clone this repository: `git clone https://github.com/Eucason/notebooklm-foldnest.git`
   - Or download as ZIP and extract

2. **Enable Developer Mode**:
   - Open Chrome and navigate to `chrome://extensions`
   - Toggle "Developer mode" switch (top-right corner)

3. **Load the Extension**:
   - Click "Load unpacked" button
   - Select the folder containing `manifest.json`
   - Extension icon should appear in toolbar

4. **Verify Installation**:
   - Navigate to [NotebookLM](https://notebooklm.google.com)
   - Sidebar should appear on left with "Project Dashboard" header
   - Console should show: `[NotebookLM FoldNest] Content script loaded`

### Method 2: Chrome Web Store (Future)
*Coming soon - pending review process*

---

## 📖 Usage Guide

### Dashboard Organization Workflow

1. **Create Folder Structure**:
   - Click "New Folder" button (folder+ icon)
   - Enter folder name in prompt
   - Click palette icon to assign color
   - Use "Add Subfolder" for nested organization

2. **Organize Notebooks**:
   - **Grid View**: Hover over notebook card → Click folder icon → Select destination
   - **List View**: Click folder icon in actions column → Select destination
   - Notebooks disappear from main view and appear inside folder

3. **Navigate Folders**:
   - Click folder header to expand/collapse
   - Use expand/collapse all buttons for bulk operations
   - Scroll within folder to see all contained notebooks

4. **Search Notebooks**:
   - Type in search box at top of sidebar
   - Results update in real-time
   - Clear button (X) to reset filter

5. **Backup Your Setup**:
   - Click export button (download icon)
   - Save JSON file to secure location
   - To restore: Click import button → Select JSON file → **Refresh page**

### Notebook Organization Workflow

1. **Create Folder Structure**:
   - Click "New Folder" in Source or Studio panel
   - Nested folders: Click "Add" icon on existing folder
   - Rename: Click pencil icon → Enter new name
   - Reorder: Use up/down arrows

2. **Organize Items**:
   - Click three-dot menu on any source/note
   - Select "Move to folder"
   - Choose destination from dropdown
   - Remove from folder: Click "Remove from Folder"

3. **Pin Important Items**:
   - Click pin icon on source/note
   - Pinned items appear at top of panel
   - Click again to unpin

4. **Bulk Selection**:
   - Source panel: Click master checkbox to select all
   - Folder level: Click folder checkbox to select folder contents
   - Use for AI context inclusion/exclusion

### Task Management Workflow

1. **Create Tasks**:
   - **Manual**: Click "New Task" button in tasks panel
   - **Quick Capture**: Highlight text in note → Click floating "+" button
   
2. **Organize Tasks**:
   - Create sections: Click "New Section" button
   - Move tasks: Click move icon → Select section
   - Color-code sections for visual grouping

3. **Set Properties**:
   - **Priority**: Click flag icon → Choose color
   - **Due Date**: Click calendar icon → Select date or use quick actions
   - **Description**: Click description icon → Add context in modal
   - **Link**: Automatically created for tasks from notes (blue icon)

4. **Track Progress**:
   - Click checkbox to mark complete
   - Completed tasks move to "Completed Tasks" section
   - Sort by priority or due date using sort button
   - Click linked task's link icon to view source note

### Search Workflow

1. **Index Notes**:
   - Open any note in Studio panel
   - Extension automatically indexes content
   - Wait 1 second for indexing to complete
   - Indexed notes show in search stats

2. **Search Content**:
   - Type query in search box
   - Results show matching notes with similarity scores
   - Click result to open note
   - Fuzzy matching finds partial/misspelled terms

3. **Manage Index**:
   - View stats: Shows indexed note count and storage used
   - Rebuild index: Settings menu → "Rebuild Search Index"
   - Clear index: Rebuild function clears and re-indexes on note opens

---

## 🔧 Technical Architecture

### Storage Model

**Local Storage (`chrome.storage.local`)**:
- Unlimited storage quota (uses `unlimitedStorage` permission)
- Per-notebook data isolation using notebook ID as key
- Schema:
  ```javascript
  {
    "notebookTreeState_{notebookId}": {
      source: { folders, mappings, pinned, tasks, taskSections },
      studio: { folders, mappings, pinned },
      settings: { showGenerators, showResearch, focusMode, tasksOpen, completedOpen }
    },
    "notebookSearchIndex_{notebookId}": {
      "{noteTitle}": { compressed: "...", lastAccess: timestamp }
    },
    "notebookLM_dashboardFolders": {
      folders: { /* folder objects */ },
      mappings: { /* notebookUrl: folderId */ },
      settings: { foldersOpen: boolean }
    }
  }
  ```

**Cloud Storage (Optional, via Google Drive AppData)**:
- OAuth 2.0 authentication using `chrome.identity`
- JSON files stored in Drive's appdata folder (user-invisible)
- Separate files for dashboard and each notebook
- Conflict resolution via timestamp comparison

### Selector System

**Dynamic Selector Configuration**:
- Remote JSON configuration fetched from GitHub Gist
- 24-hour cache TTL to reduce network calls
- Fallback to hardcoded selectors if fetch fails
- Selector arrays for fallback chains:
  ```javascript
  sourceRow: [
    '.single-source-container',
    '[data-source-id]',
    '.source-item'
  ]
  ```

**Health Monitoring**:
- 30-second interval checks for selector validity
- Logs warnings when multiple selector types fail
- Helps identify Google UI changes quickly

### Graceful Degradation

**Feature Isolation**:
- Each major feature (folders, tasks, search, pinning) tracked separately
- 3-strike failure threshold before auto-disable
- Silent failures after threshold to prevent error spam
- User-facing toast notification on first disable

**Feature Status Tracking**:
```javascript
featureStatus = {
  folderOrganization: { enabled: true, failures: 0, notified: false },
  taskManagement: { enabled: true, failures: 0, notified: false },
  // ... other features
}
```

### Performance Optimizations

**Debouncing**:
- Organizer: 250ms delay after DOM mutations
- Search: 300ms delay after keystroke
- Note indexing: 1000ms delay after note view

**DOM Efficiency**:
- Document fragments for batch insertions
- Proxy caching to prevent re-rendering on folder toggle
- Event delegation for folder tree interactions
- RequestAnimationFrame for smooth animations

**Memory Management**:
- Search index size limit: 2MB per notebook
- LRU eviction: Removes least-recently-accessed notes
- Content truncation: Max 20,000 characters per note
- LZ-String compression: ~50-70% size reduction

---

## 🔐 Privacy & Security

### Data Handling

**No External Tracking**:
- Zero analytics or telemetry
- No user behavior logging
- No data transmission to third parties

**Local-First Architecture**:
- All processing happens in browser
- No server-side components
- Data never leaves your device (except optional Cloud Sync)

### Permissions Explained

| Permission | Purpose |
|------------|---------|
| `activeTab` | Inject UI into NotebookLM tabs |
| `scripting` | Execute content scripts for DOM manipulation |
| `storage` | Save folder/task data to local storage |
| `unlimitedStorage` | Remove 5MB quota limit for search indices |
| `identity` | OAuth authentication for optional Cloud Sync |
| `host_permissions` (notebooklm.google.com) | Access NotebookLM pages |
| `host_permissions` (gist.githubusercontent.com) | Fetch remote selector config |
| `host_permissions` (googleapis.com) | Google Drive API for Cloud Sync |

### Cloud Sync Security

**OAuth 2.0 Flow**:
- Uses Chrome's built-in identity API
- No extension backend servers
- Tokens managed by Chrome, not stored by extension

**Drive AppData Folder**:
- Hidden from user's main Drive interface
- Accessible only by this extension
- Automatically deleted if extension is removed

**Encryption**:
- HTTPS for all API calls
- Data encrypted in transit by Google's infrastructure
- At-rest encryption provided by Google Drive

---

## 📊 Storage Quotas

### Local Storage
- **Quota**: Unlimited (via `unlimitedStorage` permission)
- **Usage**: 
  - Folders/mappings: ~1-5KB per notebook
  - Tasks: ~0.5KB per task
  - Search index: Up to 2MB per notebook (enforced by extension)

### Cloud Sync (Optional)
- **Quota**: 15GB Google Drive free tier (shared with other Drive content)
- **Usage**: 
  - Typically <100KB per notebook
  - Dashboard config: <50KB

---

## 🐛 Troubleshooting

### Extension Not Loading
1. Check `chrome://extensions` for error messages
2. Verify Developer Mode is enabled
3. Reload extension (click refresh icon)
4. Check browser console for `[FoldNest]` logs

### Folders Not Appearing
1. Verify you're on NotebookLM website (`notebooklm.google.com`)
2. Wait 1 second after page load for injection
3. Check if sidebar is collapsed (toggle button on left)
4. Try refreshing the page

### Items Not Moving to Folders
1. Check if item is already in a folder (three-dot menu shows current location)
2. Verify folder exists and is not deleted
3. Try refreshing page to clear stale state
4. Export data as backup, then reset and re-import

### Search Not Finding Notes
1. Open the note manually to trigger indexing
2. Wait 1 second after opening (debounce delay)
3. Check search stats to confirm note is indexed
4. Try rebuilding search index (Settings → Rebuild)

### Cloud Sync Errors
1. Check internet connection
2. Verify Google account is signed in to Chrome
3. Click "Sync Now" to manually trigger
4. Check sync status indicator for error message
5. Try disabling and re-enabling sync (re-authenticates)

### Data Loss After Update
1. **Before updating**: Always export configuration
2. Check `chrome://extensions` for extension version
3. If data missing: Import from backup JSON file
4. If no backup: Data may be unrecoverable (local storage cleared)

---

## 🤝 Contributing

### Bug Reports
- Use GitHub Issues with clear reproduction steps
- Include Chrome version, OS, and extension version
- Attach screenshots/console logs if applicable

### Feature Requests
- Describe use case and problem being solved
- Check existing issues to avoid duplicates
- Understand academic commitments may delay implementation

### Pull Requests
- Fork repository and create feature branch
- Follow existing code style (2-space indents, JSDoc comments)
- Test thoroughly on both Grid and List views
- Update README.md if adding user-facing features

---

## 📜 License

**GNU General Public License v3.0 (GPLv3)**

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

**Key Points**:
-  Use commercially
-  Modify and distribute
-  Patent use
-  Cannot sublicense
- ⚠️ **Must disclose source**: Any improvements must be shared back with the community under GPLv3

See [LICENSE](LICENSE) file for full terms.

---

## 🙏 Acknowledgments

- **NotebookLM Team**: For building an incredible research platform
- **Google Material Icons**: Icon set used throughout the UI
- **LZ-String**: Compression library by pieroxy
- **Open Source Community**: For feedback and bug reports

---

## 📧 Contact

- **Developer**: Eucason (Medical Student & Hobbyist Developer)
- **GitHub**: [@Eucason](https://github.com/Eucason)
- **Issues**: [GitHub Issues](https://github.com/Eucason/notebooklm-foldnest/issues)

---

## ⚖️ Disclaimer

This extension is an independent project and is not affiliated with, endorsed by, or sponsored by Google LLC or the NotebookLM team. "NotebookLM" is a trademark of Google LLC.

Use at your own risk. The developer assumes no liability for data loss, service interruptions, or other issues arising from the use of this extension. Always maintain backups of critical work.

---

**Version**: 0.9.3  
**Last Updated**: 2026 
**Status**: Active Development (Academic Schedule Dependent)