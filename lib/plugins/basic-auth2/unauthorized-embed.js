// Check localStorage for the basic auth credentials
(function() {
  // Create a dynamic style to hide the body and any basic auth errors.
  document.write('<style>[data-basic-auth-error] {display: none; }</style>');

  // Need to incorporate the baseUrl in order to support multiple auth sections
  // of the same site with different username/password.
  var sessionKey = window.__4front__.authSessionTokenKey;
  var authHeader = sessionStorage.getItem(sessionKey);

  // if there are stored creds in sessionStorage, use those rather than
  // display a login form.
  if (authHeader) {
    document.write('<style>body { display:none; }</style>');
    login(authHeader);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      // Show login form.
      var authForm = document.querySelector('[data-basic-auth-form]');
      var usernameElem = document.querySelector('[data-basic-auth-username]');
      var passwordElem = document.querySelector('[data-basic-auth-password]');

      // Ensure all the required elements are not present.
      if (!authForm || !usernameElem || !passwordElem) return;

      authForm.addEventListener('submit', function(event) {
        authHeader = 'Basic ' + btoa(usernameElem.value + ':' + passwordElem.value);
        login();
        event.preventDefault();
      });
    });
  }

  function login() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', location.pathname, true);
    xhr.setRequestHeader('Accept', 'text/html');
    xhr.setRequestHeader('Authorization', authHeader);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 0 || xhr.readyState === 4) {
        if (xhr.status === 200) {
          // Store the credentials in localStorage and load the page into the DOM.
          sessionStorage.setItem(sessionKey, authHeader);

          // Replace the entire document with the result.
          document.open();
          document.write(xhr.responseText);
          document.close();
        } else if (xhr.status === 401) {
          document.body.style.display = 'block';

          // If there is a data-basic-auth-error element, show it.
          var authError = document.querySelector('[data-basic-auth-error]');
          if (authError) {
            authError.style.display = 'block';
          }
        } else {
          // For all other status codes replace the page with the custom error page in the response.
          document.open();
          document.write(xhr.responseText);
          document.close();
        }
      }
    };
    xhr.send(null);
  }
})();
