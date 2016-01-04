(function() {
  document.addEventListener('DOMContentLoaded', function() {
    // Attach event listener to any logout links
    var logoutElem = document.querySelector('[data-basic-auth-logout]');
    if (logoutElem) {
      logoutElem.addEventListener('click', function(event) {
        var sessionKey = window.__4front__.authSessionTokenKey;
        sessionStorage.setItem(sessionKey, null);
        location.reload(true);
        event.preventDefault();
      });
    }
  });
})();
