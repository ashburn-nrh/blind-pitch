/*
 * Basic text screening. Two jobs:
 *  - contact details stay hidden until both people say yes (no phone numbers, handles or links
 *    in cards, reactions or guesses);
 *  - obvious abuse is masked or refused.
 * This is a first line of defence, not a moderation system: a launch needs a maintained
 * moderation service and human review of reports. See README "Before a public launch".
 */
const CONTACT = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/gi,                                   // email
  /\b(?:https?:\/\/|www\.)\S+/gi,                                 // links
  /\b[\w-]+\.(?:com|net|org|io|me|co|in|app|ly)\b\S*/gi,          // bare domains
  /(?:\+?\d[\s().-]?){7,}/g,                                      // phone-like digit runs
  /(?:^|\s)@\w{3,}/g,                                             // @handles
  /\b(?:instagram|insta|snapchat|whats\s?app|telegram|discord|wechat)\b[:\s]*\S*/gi,
];
const UNFRIENDLY = ['fuck', 'shit', 'bitch', 'cunt', 'slut', 'whore', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'nudes', 'rape', 'kill yourself', 'kys'];
const unfriendlyRe = new RegExp(`\\b(?:${UNFRIENDLY.map(w => w.replace(/\s+/g, '\\s+')).join('|')})\\w*`, 'gi');
const plain = s => String(s ?? '').normalize('NFKC').replace(/[@4]/g, 'a').replace(/[1!]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's').replace(/3/g, 'e');

export const hasContact = s => CONTACT.some(re => { re.lastIndex = 0; return re.test(String(s ?? '')); });
export const stripContact = s => CONTACT.reduce((t, re) => t.replace(re, ' •••'), String(s ?? '')).trim();
export const isUnfriendly = s => { unfriendlyRe.lastIndex = 0; return unfriendlyRe.test(plain(s)); };
export const mask = s => String(s ?? '').replace(unfriendlyRe, w => '*'.repeat(w.length));
