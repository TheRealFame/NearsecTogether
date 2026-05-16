const fs = require('fs');
const path = require('path');

// 1. Define the files you want to scan (update paths if needed)
const filesToScan = [
'src/pages/gamepad-popup.html',
'src/pages/setup.html',
'src/pages/index.html',
'src/pages/host.html',
'src/pages/dashboard.html',
'website/nearsec-arcade.html',
'src/scripts/audio-util.js',
'src/scripts/server.js',
'src/scripts/host.js',
'src/scripts/viewer.js',
'kbm_bindings.json',
'website/arcade.js'
];

const dictionary = {};

// Helper to clean up strings and generate a safe JSON key
function addEntry(text, prefix = 'txt') {
    // Remove HTML entities, extra spaces, and newlines
    const cleanText = text.replace(/&[a-z]+;/g, '').trim().replace(/\s+/g, ' ');

    // Ignore empty strings, single characters, pure numbers, or pure symbols
    if (cleanText.length < 2 || /^[0-9\W]+$/.test(cleanText)) return;

    // Generate a key based on the first few words (e.g., "Start Sharing" -> "start_sharing")
    const keyBase = cleanText.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 35).replace(/_$/, '');
    const key = `${prefix}_${keyBase}`;

    // Add to dictionary if it doesn't exist
    if (!dictionary[key]) {
        dictionary[key] = cleanText;
    }
}

// 2. The Extraction Logic
filesToScan.forEach(filePath => {
    const fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) {
        console.log(`⚠️  Skipping ${filePath} (File not found)`);
        return;
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    if (filePath.endsWith('.html')) {
        // Extract text between HTML tags: > Text Here <
        // We ignore <script> and <style> blocks
        const htmlWithoutScripts = content.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
        const tagMatches = htmlWithoutScripts.matchAll(/>([^<]+)</g);
        for (const match of tagMatches) {
            addEntry(match[1], 'ui');
        }

        // Extract placeholder attributes: placeholder="Search games..."
        const placeholderMatches = content.matchAll(/placeholder=["']([^"']+)["']/g);
        for (const match of placeholderMatches) {
            addEntry(match[1], 'ph');
        }
    }
    else if (filePath.endsWith('.js')) {
        // Look for specific UI functions in your codebase

        // log('Text', 'ok') or sysChat('Text')
        const funcMatches = content.matchAll(/(?:log|sysChat|setStatus|showTunnelError)\s*\(\s*['"](.*?)['"]/g);
        for (const match of funcMatches) {
            addEntry(match[1], 'msg');
        }

        // document.getElementById(...).textContent = 'Text'
        const textContentMatches = content.matchAll(/\.textContent\s*=\s*['"](.*?)['"]/g);
        for (const match of textContentMatches) {
            addEntry(match[1], 'ui');
        }

        // appendChat('Name', 'Text')
        const chatMatches = content.matchAll(/appendChat\([^,]+,\s*['"](.*?)['"]/g);
        for (const match of chatMatches) {
            addEntry(match[1], 'msg');
        }
    }
});

        // 3. Save the Dictionary
        const outputDir = path.join(__dirname, 'assets', 'locales');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'en.json');
        fs.writeFileSync(outputPath, JSON.stringify(dictionary, null, 2));

        console.log(`\n✅ Extraction complete! Found ${Object.keys(dictionary).length} unique strings.`);
        console.log(`📂 Saved dictionary to: ${outputPath}\n`);
