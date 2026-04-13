type CookieRecord = {
  value: string;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

import { createPluginLogger } from '../../../lib/plugin-logger.js';

const logger = createPluginLogger('web-simple-fetch');

class SiteCookieJar {
  private cookies: Record<string, CookieRecord> = {};

  setCookie(cookie: string) {
    const [cookiePair, ...attributePairs] = cookie
      .split(';')
      .map(part => part.trim());
    const [name, value] = cookiePair.split('=');
    const cookieRecord: CookieRecord = { value };

    for (const attributePair of attributePairs) {
      const [attrName, attrValue] = attributePair
        .split('=')
        .map(part => part.trim());
      switch (attrName.toLowerCase()) {
        case 'expires':
          cookieRecord.expires = new Date(attrValue);
          break;
        case 'path':
          cookieRecord.path = attrValue;
          break;
        case 'domain':
          cookieRecord.domain = attrValue;
          break;
        case 'secure':
          cookieRecord.secure = true;
          break;
        case 'httpurl':
          cookieRecord.httpOnly = true;
          break;
      }
    }

    this.cookies[name] = cookieRecord;
  }

  getCookieHeader(url: string): string {
    const { hostname, pathname, protocol } = new URL(url);
    const validCookies = Object.entries(this.cookies).filter(
      ([name, record]) => {
        if (record.expires && record.expires < new Date()) {
          delete this.cookies[name];
          return false;
        }
        if (record.domain && hostname && !hostname.endsWith(record.domain)) {
          return false;
        }
        if (record.path && pathname && !pathname.startsWith(record.path)) {
          return false;
        }
        if (record.secure && protocol !== 'https:') {
          return false;
        }
        return true;
      }
    );

    return validCookies
      .map(([name, record]) => `${name}=${record.value}`)
      .join('; ');
  }

  clearCookies() {
    this.cookies = {};
  }
}

// format: cookieJar[domain] = SiteCookieJar
const siteCookieJars: Record<string, SiteCookieJar> = {};

export const cookieJar = {
  setCookies: (site: string, setCookies: string[]) => {
    setCookies.forEach(cookie => {
      const cookieAttrs = cookie.split(';').map(part => part.trim());
      const domainAttr = cookieAttrs.find(attr =>
        attr.toLowerCase().startsWith('domain=')
      );
      const domain = domainAttr ? domainAttr.split('=')[1] : site;
      if (!siteCookieJars[domain]) {
        siteCookieJars[domain] = new SiteCookieJar();
      }
      siteCookieJars[domain].setCookie(cookie);
    });
  },

  getCookieHeaderForSite: (url: string): string => {
    // Get cookies for this domain, and all parent domains, and return the appropriate
    // Cookie header value. For example, if the domain is "sub.example.com", get cookies
    // for "sub.example.com", "example.com", and ".com" (if they exist) and combine them
    // according to the rules in SiteCookieJar.getCookieHeader.
    const { hostname, pathname, protocol } = new URL(url);
    const domainParts = hostname.split('.');
    const cookieHeaders = [];
    for (let i = 0; i < domainParts.length; i++) {
      const domainToCheck = domainParts.slice(i).join('.');
      if (siteCookieJars[domainToCheck]) {
        const cookieHeader = siteCookieJars[domainToCheck].getCookieHeader(url);
        if (cookieHeader) {
          cookieHeaders.push(cookieHeader);
        }
      }
    }
    logger.log(
      `Getting cookies for domain ${hostname} (path: ${pathname}, secure: ${protocol === 'https:'}). Found cookie headers: ${cookieHeaders.join(' | ')}`
    );
    return cookieHeaders.join('; ');
  },

  clearCookiesForDomain: (domain: string) => {
    // Clear cookies for the specified domain and all subdomains. For example, if the domain
    // is "example.com", clear cookies for "example.com", "sub.example.com",
    // "another.sub.example.com", etc.
    for (const site of Object.keys(siteCookieJars)) {
      if (site.endsWith(domain)) {
        logger.log(`Clearing cookies for site ${site}`);
        siteCookieJars[site].clearCookies();
      }
    }
  },
};
