# TODO: Implement LinkedIn Login Session Caching

- [x] Add COOKIES_FILE constant and import necessary modules if needed
- [x] Create saveCookies(driver) function to save browser cookies to file
- [x] Create loadCookies(driver) function to load cookies from file
- [x] Modify login(driver) function to check for cached session first, then login if necessary and save cookies
- [x] Test the updated script to ensure caching works and login is skipped on subsequent runs
