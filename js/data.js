/* Static game content: questions, avatar palettes, unlock slots, practice bots. */
export const QS = [["Mountains","Beach"],["Night owl","Early bird"],["Cook together","Order in"],["Dogs","Cats"],["Plan everything","Wing it"],["Rainy days","Sunny days"]];
export const SELFQ = [
  { me:"At a new café, you order…", them:"At a new café, they order…", opts:["The weirdest thing on the menu","My usual, always","Whatever the person before me got"] },
  { me:"Your ideal Sunday is…", them:"Their ideal Sunday is…", opts:["Out exploring somewhere new","Brunch with friends","Couch, snacks and a series"] },
  { me:"At a party, you're the one…", them:"At a party, they're the one…", opts:["Running the playlist","In the kitchen talking to three people","Befriending the host's pet"] },
];
export const WORDS = ["chai","rain","jazz","kite","moon","tacos","films","books"];
export const SKINS = ["#f1c6a5","#d9a07a","#b97a52","#7d5034"];
export const HAIRS = ["#1b1410","#4a2c1a","#a8642f","#d8c29d"];
export const BGS = [["#ffb36b","#e2557a"],["#6b8cff","#9b5de5"],["#3fc1c9","#2f9e74"],["#ffd166","#ef476f"]];
export const ADJ = ["Velvet","Midnight","Paper","Neon","Quiet","Golden","Lucky","Hidden","Silver","Electric"];
export const NOUN = ["Otter","Kite","Comet","Fox","Lantern","Moth","Harbor","Sparrow","Tiger","Cactus"];
export const REACTS = ["Ha!","Same!","Nice one","Oops","You're good at this","Okay, impressive"];
export const SLOTS = [
  {at:12, label:"Name", val:p=>`${p.name}, ${p.age}`},
  {at:30, label:"City", val:p=>p.city || 'Somewhere nice'},
  {at:50, label:"On repeat", val:p=>p.song || 'Keeping that a mystery'},
  {at:70, label:"Bio", val:p=>p.bio || 'No bio. Mysterious.'},
];
export const BOTS = [
  { name:"Meera", age:27, city:"Bengaluru", song:"cold/mess by Prateek Kuhad", bio:"Children's book illustrator. Draws dragons for a living and will kindly judge your chai order.",
    sk:1, hr:0, bg:0, hs:1, self:[0,0,1], prefs:[0,0,0,1,1,0], hi:"Hi stranger. I'm told we play first and talk later. I'm weirdly good at games, fair warning." },
  { name:"Kabir", age:29, city:"Pune", song:"Holocene by Bon Iver", bio:"Sound engineer. Records rain for film soundtracks and owns too many headphones.",
    sk:2, hr:0, bg:1, hs:0, self:[1,2,2], prefs:[1,0,1,0,1,0], hi:"Hey. No photos, no bios, just vibes. I like this already." },
  { name:"Zoya", age:26, city:"Mumbai", song:"Sunflower by Rex Orange County", bio:"Marine biologist. Counts sea turtles for work. Dangerously competitive at board games.",
    sk:1, hr:1, bg:2, hs:1, self:[0,0,0], prefs:[1,1,0,1,0,1], hi:"Hello! I take co-op games very seriously. We are winning this." },
];
export const SAME = ["Okay, same page already.","Same! Good sign.","Wait, you too?","Knew it."];
export const DIFF = ["Hmm. Bold. I respect it.","Opposites attract, right?","We'll argue about this later.","Interesting. Noted."];
