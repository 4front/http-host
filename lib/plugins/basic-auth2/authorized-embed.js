(function() {
  document.addEventListener('DOMContentLoaded', function() {
    // Attach event listener to any logout links
    var logoutElem = document.querySelector('[data-basic-auth-logout]');
    if (!logoutElem) return;

    logoutElem.addEventListener('click', function() {
      switch (window.__4front__.basicAuthType) {
      case 'standard':
        standardAuthLogout();
        break;
      case 'custom':
        customAuthLogout();
        break;
      default:
        break;
      }
    });
  });

  function customAuthLogout() {
    var sessionKey = window.__4front__.authSessionTokenKey;

    // Clear out the auth token from browser session
    // storage and reload the window.
    sessionStorage.removeItem(sessionKey);
  }

  function standardAuthLogout() {
    // Make an XHR call with intentionally wrong credentials
    var xhr = new XMLHttpRequest();
    xhr.open('GET', location.pathname, false);
    xhr.setRequestHeader('Accept', 'text/html');
    xhr.setRequestHeader('Authorization', 'Basic ' + btoa('__invalid__:__invalid'));
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.send();
  }
})();
