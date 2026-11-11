// Site content that changes between committees. Edit here, no other code needs touching.

export const SITE = {
  name: "StartUp Link UniMelb",
  email: "info@startuplinkunimelb.net",
  joinUrl: "https://umsu.unimelb.edu.au/buddy-up/clubs/clubs-listing/join/8055/",
  instagram: "https://www.instagram.com/startuplinkunimelb/",
};

export const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/events", label: "What's on" },
  { href: "/partners", label: "Partner with us" },
  { href: "/committee", label: "Committee" },
  { href: "/recruitment", label: "Recruitment" },
];

export type Office = string | string[];
export type Term = {
  term: string;
  current: boolean;
  president: Office;
  secretary: Office;
  treasurer: Office;
};

// Committee, listed by term. A term spans two years (e.g. "24-25") because office-bearers
// serve from the middle of one year into the next. To update at handover: add a new object
// to the TOP of the list, set current: true on it and current: false on the one below.
// An office with several holders takes an array of names, shown top to bottom.
export const COMMITTEE: Term[] = [
  { term: "26-27", current: true, president: "Sofia Selimi", secretary: ["Isabella Sein", "Anya Hoodbhoy"], treasurer: "Ethan Rajan" },
  { term: "25-26", current: false, president: "Arjun Baheti", secretary: "Jessica Pang", treasurer: "Flora Hsiao" },
  { term: "24-25", current: false, president: "Arjun Baheti", secretary: "Angel Tao", treasurer: "Mitchell White" },
  { term: "23-24", current: false, president: "Linh Luong", secretary: "Joe Tham", treasurer: "Jennifer Li" },
];

export type Partner = { id: string; name: string; logo: string; url: string; mono?: boolean };

// Past partners shown as the logo strip on the home page. Put logo files in public/img.
// `mono: true` is for solid black wordmarks, which are turned white on the dark background.
export const PARTNERS: Partner[] = [
  { id: "ptn-antler", name: "Antler", logo: "/img/antler.svg", url: "https://www.antler.co" },
  { id: "ptn-blackbird", name: "Blackbird", logo: "/img/blackbird.png", mono: true, url: "https://www.blackbird.vc" },
  { id: "ptn-startmate", name: "Startmate", logo: "/img/startmate.png", mono: true, url: "https://www.startmate.com" },
  { id: "ptn-investorhub", name: "InvestorHub", logo: "/img/investorhub.png", mono: true, url: "https://investorhub.com" },
  { id: "ptn-archa", name: "Archa", logo: "/img/archa.png", url: "https://www.archa.com.au" },
  { id: "ptn-zeller", name: "Zeller", logo: "/img/zeller.png", mono: true, url: "https://www.myzeller.com" },
];

export const TEAMS = [
  { name: "Events", blurb: "Plan and run the talks, socials and flagship nights our members show up for." },
  { name: "Projects", blurb: "Work with industry startups on real projects that contribute to their business." },
  { name: "External Relations", blurb: "Build partnerships with startups, investors and sponsors across the ecosystem." },
  { name: "Marketing", blurb: "Tell our story across socials, campaigns and content that grows the club." },
];

export const STATS = [
  { value: 700, suffix: "+", label: "Members in 2025" },
  { value: 45, suffix: "+", label: "Committee" },
  { value: 10, suffix: "+", label: "Events a year" },
  { value: 4, suffix: "", label: "Branches nationally" },
];
