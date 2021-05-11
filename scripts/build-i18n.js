/**
 * Build i18n files
 *
 * Adapted from
 * https://github.com/jwbth/convenient-discussions/blob/0908468075b0acbde3425ab947f191d92535aa62/buildI18n.js
 * Licence: MIT
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const warning = (text) => console.log(chalk.yellowBright(text));
const code = chalk.inverse;
const keyword = chalk.cyan;

const ALLOWED_TAGS = [
	'b',

	// Haven't met in practice yet, but perhaps these tags could be helpful for RTL languages?
	'bdi',
	'bdo',

	'code',
	'em',
	'i',
	'kbd',
	'li',
	'nowiki',
	'ol',
	'p',
	'pre',
	'span',
	'sup',
	'strong',
	'syntaxhighlight',
	'ul',
	'var',
];

function hideText(text, regexp, hidden) {
	return text.replace(regexp, (s) => '\x01' + hidden.push(s) + '\x02');
}

function unhideText(text, hidden) {
	while (text.match(/\x01\d+\x02/)) {
		text = text.replace(/\x01(\d+)\x02/g, (s, num) => hidden[num - 1]);
	}

	return text;
}

DOMPurify.addHook('uponSanitizeElement', (currentNode, data, config) => {
	if (!Object.keys(data.allowedTags).includes(data.tagName) && data.tagName !== 'body') {
		// `< /li>` qualifies as "#comment" and has content available under `currentNode.textContent`.
		warning(
			`Disallowed tag found and sanitized in string "${keyword(config.stringName)}" in ${keyword(
				config.fileName
			)}: ${code(
				currentNode.outerHTML || currentNode.textContent
			)}. See https://translatewiki.net/wiki/Wikimedia:Twinkle-${config.stringName}/${config.lang}`
		);
	}
});

DOMPurify.addHook('uponSanitizeAttribute', (currentNode, hookEvent, config) => {
	if (!Object.keys(hookEvent.allowedAttributes).includes(hookEvent.attrName)) {
		warning(
			`Disallowed attribute found and sanitized in string "${keyword(config.stringName)}" in ${keyword(
				config.fileName
			)}: ${code(hookEvent.attrName)} with value "${
				hookEvent.attrValue
			}". See https://translatewiki.net/wiki/Wikimedia:Twinkle-${config.stringName}/${config.lang}`
		);
	}
});

const root = __dirname + '/..';

fs.readdirSync(root + '/i18n/').forEach((fileName) => {
	if (!(path.extname(fileName) === '.json' && fileName !== 'qqq.json')) {
		return;
	}
	const [, lang] = path.basename(fileName).match(/^(.+)\.json$/) || [];
	const strings = JSON.parse(fs.readFileSync(root + `/i18n/${fileName}`).toString());
	Object.keys(strings)
		.filter((name) => {
			if (typeof strings[name] === 'string') {
				return true;
			} else {
				delete strings[name];
				return false;
			}
		})
		.forEach((stringName) => {
			const hidden = [];
			let sanitized = hideText(strings[stringName], /<nowiki(?: [\w ]+(?:=[^<>]+?)?| *)>([^]*?)<\/nowiki *>/g, hidden);

			sanitized = DOMPurify.sanitize(sanitized, {
				ALLOWED_TAGS,
				ALLOWED_ATTR: ['class', 'dir', 'href', 'target'],
				ALLOW_DATA_ATTR: false,
				fileName,
				stringName,
				lang,
			});

			sanitized = unhideText(sanitized, hidden);

			// Just in case dompurify or jsdom gets outdated or the repository gets compromised, we will
			// just manually check that only allowed tags are present.
			for (const [, tagName] of sanitized.matchAll(/<(\w+)/g)) {
				if (!ALLOWED_TAGS.includes(tagName.toLowerCase())) {
					warning(
						`Disallowed tag ${code(tagName)} found in ${keyword(fileName)} at the late stage: ${keyword(
							sanitized
						)}. The string has been removed altogether.`
					);
					delete strings[stringName];
					return;
				}
			}

			// The same with suspicious strings containing what seems like the "javascript:" prefix or
			// one of the "on..." attributes.
			let test = sanitized.replace(/&\w+;|\s+/g, '');
			if (/javascript:/i.test(test) || /\bon\w+\s*=/i.test(sanitized)) {
				warning(
					`Suspicious code found in ${keyword(fileName)} at the late stage: ${keyword(
						sanitized
					)}. The string has been removed altogether.`
				);
				delete strings[stringName];
				return;
			}

			strings[stringName] = sanitized;
		});
	let json = JSON.stringify(strings, null, '\t')
		.replace(/&nbsp;/g, ' ')
		.replace(/&#32;/g, ' ');
	if (lang === 'en') {
		// Prevent creating "</nowiki>" character sequences when building the main script file.
		json = json.replace(/<\/nowiki>/g, '</" + String("") + "nowiki>');
	}

	fs.mkdirSync(root + '/build-i18n-temp', { recursive: true });
	fs.writeFileSync(root + `/build-i18n-temp/${lang}.json`, json);
});

console.log('Internationalization files have been built successfully.');