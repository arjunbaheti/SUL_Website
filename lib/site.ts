// Site-wide details used for SEO: the canonical URL, names people search for, and the JSON-LD
// structured data Google reads to understand who we are.

/** Production URL. Vercel provides the live domain at build time. */
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const SITE_NAME = "StartUp Link UniMelb";

export const SITE_DESCRIPTION =
  "StartUp Link UniMelb is the University of Melbourne's startup club: we connect UniMelb students with startup jobs, internships, entrepreneurship workshops and Melbourne's founder community.";

/** Ways people write our name; used as alternateName so searches for any of them find us. */
export const ALTERNATE_NAMES = [
  "StartUp Link",
  "Startup Link UniMelb",
  "StartupLink",
  "StartUp Link University of Melbourne",
  "StartUp Link Melbourne",
  "SUL UniMelb",
];

export const SOCIALS = [
  "https://www.instagram.com/startuplinkunimelb/",
  "https://www.linkedin.com/company/startuplinkunimelb/",
];

/** Organization + WebSite structured data, rendered once in the root layout. */
export function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        alternateName: ALTERNATE_NAMES,
        url: SITE_URL,
        logo: `${SITE_URL}/icon.png`,
        email: "info@startuplinkunimelb.net",
        description: SITE_DESCRIPTION,
        sameAs: SOCIALS,
        areaServed: { "@type": "City", name: "Melbourne" },
        parentOrganization: { "@type": "Organization", name: "StartUp Link Australia" },
        // A student club at the University of Melbourne, joined through UMSU.
        memberOf: { "@type": "Organization", name: "University of Melbourne Student Union (UMSU)" },
        knowsAbout: ["Startups", "Entrepreneurship", "Startup jobs", "Internships", "Venture capital", "University of Melbourne"],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        alternateName: ALTERNATE_NAMES,
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-AU",
      },
    ],
  };
}

/** Per-page title, description, canonical URL and matching link-preview text. */
export function pageMeta(title: string, description: string, path: string) {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
    twitter: { title, description },
  };
}
