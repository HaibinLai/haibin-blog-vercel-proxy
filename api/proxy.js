const ORIGIN = "https://www.haibinlaiblog.top";
const ORIGIN_HOST = "www.haibinlaiblog.top";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-host",
  "x-forwarded-proto"
]);

function getTargetUrl(req) {
  const publicUrl = new URL(req.url, `https://${req.headers.host}`);
  const path = publicUrl.searchParams.get("path") || "";
  publicUrl.searchParams.delete("path");

  const pathname = path.startsWith("/") ? path : `/${path}`;
  return `${ORIGIN}${pathname}${publicUrl.search}`;
}

function getProxyPath(req) {
  const publicUrl = new URL(req.url, `https://${req.headers.host}`);
  const path = publicUrl.searchParams.get("path") || "";
  return path.startsWith("/") ? path : `/${path}`;
}

function getPublicOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

function getRequestHeaders(req) {
  const headers = {};

  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) {
      headers[name] = value;
    }
  }

  headers.host = ORIGIN_HOST;
  headers["accept-encoding"] = "identity";
  return headers;
}

async function getRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function rewriteLocation(location, publicOrigin) {
  if (!location) {
    return location;
  }

  return location
    .replaceAll(ORIGIN, publicOrigin)
    .replaceAll(`http://${ORIGIN_HOST}`, publicOrigin)
    .replaceAll(`//${ORIGIN_HOST}`, `//${new URL(publicOrigin).host}`);
}

function rewriteText(body, publicOrigin) {
  const publicHost = new URL(publicOrigin).host;

  return body
    .replaceAll(ORIGIN, publicOrigin)
    .replaceAll(`http://${ORIGIN_HOST}`, publicOrigin)
    .replaceAll(`//${ORIGIN_HOST}`, `//${publicHost}`);
}

function getAdminBootstrap(publicOrigin) {
  const sprintfFallback = String.raw`
    function sprintf(format) {
      var index = 0;
      var args = Array.prototype.slice.call(arguments, 1);
      return String(format).replace(/%[sdif]/g, function() {
        return typeof args[index] === "undefined" ? "" : args[index++];
      });
    }`;

  return `
<script src="${publicOrigin}/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>
<script src="${publicOrigin}/wp-includes/js/jquery/jquery-migrate.min.js?ver=3.4.1"></script>
<script>
window.userSettings = window.userSettings || {
  uid: "0",
  time: String(Math.floor(Date.now() / 1000)),
  secure: "1"
};
</script>
<script src="${publicOrigin}/wp-includes/js/utils.min.js?ver=6.9.4"></script>
<script src="${publicOrigin}/wp-includes/js/dist/hooks.min.js?ver=6.9.4"></script>
<script src="${publicOrigin}/wp-includes/js/dist/i18n.min.js?ver=6.9.4"></script>
<script>
(function() {
  window.jQuery = window.jQuery || window.$;
  window.$ = window.jQuery || window.$;
  window.Zepto = window.Zepto || window.jQuery;
  window.wp = window.wp || {};
  ${sprintfFallback}
  window.wp.i18n = window.wp.i18n || {
    __: function(text) { return text; },
    _x: function(text) { return text; },
    _n: function(single, plural, number) { return Number(number) === 1 ? single : plural; },
    _nx: function(single, plural, number) { return Number(number) === 1 ? single : plural; },
    sprintf: sprintf,
    setLocaleData: function() {},
    hasTranslation: function() { return false; },
    isRTL: function() { return false; }
  };
  window.wp.i18n.sprintf = window.wp.i18n.sprintf || sprintf;
  window.getUserSetting = window.getUserSetting || function(name, fallback) {
    return typeof fallback === "undefined" ? "" : fallback;
  };
  window.setUserSetting = window.setUserSetting || function() {};
  window.deleteUserSetting = window.deleteUserSetting || function() {};
  window.wp.getUserSetting = window.wp.getUserSetting || window.getUserSetting;
  window.wp.setUserSetting = window.wp.setUserSetting || window.setUserSetting;
  window.wp.deleteUserSetting = window.wp.deleteUserSetting || window.deleteUserSetting;
})();
</script>`;
}

function injectAdminBootstrap(body, publicOrigin, pathname, contentType) {
  if (
    !contentType.includes("text/html") ||
    !isPrivateWordPressPath(pathname) ||
    body.includes("data-haibin-admin-bootstrap")
  ) {
    return body;
  }

  const bootstrap = `<script data-haibin-admin-bootstrap="1"></script>${getAdminBootstrap(publicOrigin)}`;

  if (/<head(\s[^>]*)?>/i.test(body)) {
    return body.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${bootstrap}`);
  }

  return `${bootstrap}${body}`;
}

function splitSetCookieHeader(header) {
  if (!header) {
    return [];
  }

  return header.split(/,(?=\s*[^;,]+=)/g).map((cookie) => cookie.trim());
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  if (typeof headers.raw === "function") {
    return headers.raw()["set-cookie"] || [];
  }

  return splitSetCookieHeader(headers.get("set-cookie"));
}

function rewriteSetCookie(cookie) {
  return cookie
    .replace(/;\s*domain=(www\.)?haibinlaiblog\.top/gi, "")
    .replace(/;\s*domain=\.?haibinlaiblog\.top/gi, "");
}

function isPrivateWordPressPath(pathname) {
  const normalizedPathname = pathname.toLowerCase();

  return (
    normalizedPathname.startsWith("/login") ||
    normalizedPathname.startsWith("/wp-login.php") ||
    normalizedPathname.startsWith("/wp-admin") ||
    normalizedPathname.startsWith("/wp-includes") ||
    normalizedPathname.startsWith("/wp-content/plugins") ||
    normalizedPathname.startsWith("/wp-json") ||
    normalizedPathname.startsWith("/xmlrpc.php")
  );
}

function isLoginPath(pathname) {
  const normalizedPathname = pathname.toLowerCase();
  return (
    normalizedPathname.startsWith("/login") ||
    normalizedPathname.startsWith("/wp-login.php")
  );
}

function hasWordPressTestCookie(cookies) {
  return cookies.some((cookie) =>
    cookie.toLowerCase().startsWith("wordpress_test_cookie=")
  );
}

module.exports = async function proxy(req, res) {
  const publicOrigin = getPublicOrigin(req);
  const targetUrl = getTargetUrl(req);
  const proxyPath = getProxyPath(req);

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: getRequestHeaders(req),
    body: await getRequestBody(req),
    redirect: "manual"
  });

  res.statusCode = upstream.status;

  upstream.headers.forEach((value, name) => {
    const headerName = name.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(headerName) || headerName === "set-cookie") {
      return;
    }

    if (headerName === "location") {
      res.setHeader(name, rewriteLocation(value, publicOrigin));
      return;
    }

    res.setHeader(name, value);
  });

  const cookies = getSetCookieHeaders(upstream.headers).map(rewriteSetCookie);

  if (isLoginPath(proxyPath) && !hasWordPressTestCookie(cookies)) {
    cookies.push(
      "wordpress_test_cookie=WP%20Cookie%20check; Path=/; Secure; SameSite=Lax"
    );
  }

  if (cookies.length > 0) {
    res.setHeader("set-cookie", cookies);
  }

  const contentType = upstream.headers.get("content-type") || "";
  const isRewritableTextResponse =
    contentType.includes("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml");
  const isTextResponse =
    isRewritableTextResponse || contentType.includes("javascript");

  if (isTextResponse) {
    const body = injectAdminBootstrap(
      await upstream.text(),
      publicOrigin,
      proxyPath,
      contentType
    );
    res.setHeader(
      "cache-control",
      cookies.length > 0 || isPrivateWordPressPath(proxyPath)
        ? "private, no-store"
        : "s-maxage=60, stale-while-revalidate=300"
    );
    res.end(
      isRewritableTextResponse ? rewriteText(body, publicOrigin) : body
    );
    return;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  res.end(body);
};
