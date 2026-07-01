const fs = require('fs');
const en = JSON.parse(fs.readFileSync('assets/locales/en.json'));
const es = JSON.parse(fs.readFileSync('assets/locales/es.json'));

const map = {};
for (const key in en) {
    if (es[key]) {
        map[en[key]] = es[key];
    }
}
console.log("Mapping for 'Arcade':", map["Arcade"]);
