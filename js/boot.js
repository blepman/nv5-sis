(function () {
  var path = location.pathname || "";
  var match = path.match(/^(.*)\/content(?:\/index\.html|\/)?$/i);
  if (!match) {
    return;
  }
  var root = match[1] || "";
  if (root === "") {
    root = "/sis";
  }
  location.replace(root + "/" + location.search + location.hash);
})();
