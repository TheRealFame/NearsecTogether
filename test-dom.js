const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('website/nearsec-arcade.html', 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;
const NodeFilter = dom.window.NodeFilter;

const en = JSON.parse(fs.readFileSync('assets/locales/en.json'));
const es = JSON.parse(fs.readFileSync('assets/locales/es.json'));

const translationMap = {};
for (const key in en) {
    if (es[key]) {
        translationMap[en[key]] = es[key];
    }
}

const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
const textNodes = [];
let node;
while (node = walker.nextNode()) textNodes.push(node);

textNodes.forEach(node => {
    const originalText = node.nodeValue.trim();
    if (translationMap[originalText]) {
        node.nodeValue = node.nodeValue.replace(originalText, translationMap[originalText]);
    }
});

const span = document.querySelector('nav .logo span');
console.log("Span text:", span.textContent);
