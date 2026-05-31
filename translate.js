const fs = require('fs');

// The 5 target languages you wanted to build
const targets = [
    { name: 'Spanish', code: 'es' },
{ name: 'French', code: 'fr' },
{ name: 'German', code: 'de' },
{ name: 'Portuguese', code: 'pt' },
{ name: 'Japanese', code: 'ja' }
];

async function translateChunk(chunkObj, langName, batchIdx, totalBatches) {
    console.log(`    -> Processing batch ${batchIdx} of ${totalBatches}...`);

    const requestBody = {
        model: "qwen2.5-7b-instruct-1m",
        messages: [
            {
                role: "system",
                content: `You are a strict JSON translation API. Translate ONLY the values of the provided JSON object into ${langName}.
                RULES:
                1. Output ONLY a raw, valid JSON object.
                2. DO NOT wrap the output in markdown blocks (e.g., no \`\`\`json).
                3. KEEP ALL KEYS EXACTLY THE SAME.
                4. You MUST properly escape any internal double quotes using \\"
                5. You MUST preserve special formatting characters like \\x1b or \\n exactly as they are.`
            },
            {
                role: "user",
                content: JSON.stringify(chunkObj)
            }
        ],
        temperature: 0,
        stream: false
    };

    const response = await fetch('http://localhost:1234/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    const json = await response.json();

    if (json.error) {
        throw new Error(`LM Studio Error: ${json.error.message}`);
    }

    let rawResponse = json.choices[0].message.content.trim();

    // 1. Strip markdown wrappers if the model disobeyed
    rawResponse = rawResponse.replace(/^```json/im, '').replace(/```$/im, '').trim();

    // 2. Isolate the JSON object
    const startIndex = rawResponse.indexOf('{');
    const endIndex = rawResponse.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1) {
        throw new Error(`No JSON object found in response.`);
    }

    const cleanJsonString = rawResponse.substring(startIndex, endIndex + 1);

    try {
        return JSON.parse(cleanJsonString);
    } catch (err) {
        // If it still fails, log the corrupted text so we can see what the model broke
        console.error(`\n[!] JSON Parse Error on Batch ${batchIdx}. Corrupted Output:\n${cleanJsonString}\n`);
        throw err;
    }
}

async function startAFKTranslation() {
    try {
        const enRaw = fs.readFileSync('assets/locales/en.json', 'utf8');
        const enJSON = JSON.parse(enRaw);
        const entries = Object.entries(enJSON);

        // Lowered chunk size to 20 to reduce the chance of syntax hallucinations
        const chunkSize = 20;

        console.log(`[Ollama Suite] Found en.json with ${entries.length} entries.`);
        console.log(`[Ollama Suite] Starting total automation for ${targets.length} languages.\n`);

        for (const target of targets) {
            console.log(`==================================================`);
            console.log(`STARTING COMPILATION FOR: ${target.name.toUpperCase()} (${target.code})`);
            console.log(`==================================================`);

            const translatedJSON = {};

            for (let i = 0; i < entries.length; i += chunkSize) {
                const chunk = entries.slice(i, i + chunkSize);
                const chunkObj = Object.fromEntries(chunk);
                const batchIdx = Math.floor(i / chunkSize) + 1;
                const totalBatches = Math.ceil(entries.length / chunkSize);

                let success = false;
                let retries = 2;

                while (!success && retries >= 0) {
                    try {
                        const cleanChunk = await translateChunk(chunkObj, target.name, batchIdx, totalBatches);
                        Object.assign(translatedJSON, cleanChunk);
                        success = true;
                    } catch (err) {
                        console.warn(`    ⚠️ Batch ${batchIdx} failed (${err.message}). Retries left: ${retries}`);
                        retries--;
                        if (retries < 0) {
                            console.warn(`    🚨 Batch ${batchIdx} completely failed! Injecting English fallbacks to prevent crash.`);
                            // Fallback: Copy the English strings for this batch so the file still compiles safely
                            Object.assign(translatedJSON, chunkObj);
                        } else {
                            await new Promise(res => setTimeout(res, 2000));
                        }
                    }
                }
            }

            fs.writeFileSync(
                `assets/locales/${target.code}.json`,
                JSON.stringify(translatedJSON, null, 2),
                             'utf8'
            );
            console.log(`\n[✓] DONE! Saved: assets/locales/${target.code}.json\n`);
        }

        console.log(`==================================================`);
        console.log(`[✓] ALL TRANSLATIONS COMPLETED SUCCESSFULLY!`);
        console.log(`==================================================`);

    } catch (e) {
        console.error(`\n[✗] Automation halted early due to error:`, e.message);
    }
}

startAFKTranslation();
