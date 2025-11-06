const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const INPUT_FILE = 'merged.txt';
const PROGRESS_FILE = 'progress.json';
const LOG_FILE = 'logs.txt';
const COOKIES_FILE = 'cookies.json';
const BATCH_SIZE = 50;

// Load progress
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return data.lastProcessedLine || 0;
  }
  return 0;
}

// Save progress
function saveProgress(lastProcessedLine) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastProcessedLine }, null, 2));
}

// Save cookies
function saveCookies(driver) {
  return driver.manage().getCookies().then(cookies => {
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    log('Cookies saved');
  });
}

// Load cookies
function loadCookies(driver) {
  if (fs.existsSync(COOKIES_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    return Promise.all(cookies.map(cookie => driver.manage().addCookie(cookie))).then(() => {
      log('Cookies loaded');
      return true;
    }).catch(() => {
      log('Failed to load cookies');
      return false;
    });
  }
  return Promise.resolve(false);
}

// Log message
function log(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (error) {
    if (error.code === 'EBUSY') {
      // File is locked, skip writing to file but still log to console
      console.log(`Log file locked, logging to console only: ${message}`);
    } else {
      throw error; // Re-throw other errors
    }
  }
  console.log(message);
}

// Load URLs from file
function loadUrls() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file ${INPUT_FILE} not found`);
  }
  const content = fs.readFileSync(INPUT_FILE, 'utf8');
  return content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

// Setup WebDriver
async function setupDriver(visible = false) {
  const options = new chrome.Options();
  if (!visible) {
    options.addArguments('--headless');
  }
  options.addArguments('--no-sandbox');
  options.addArguments('--disable-dev-shm-usage');
  options.addArguments('--disable-gpu');
  options.addArguments('--window-size=1920,1080');
  options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();
}

// Login to LinkedIn
async function login(driver) {
  // Try to load cached session
  const cookiesLoaded = await loadCookies(driver);
  if (cookiesLoaded) {
    await driver.get('https://www.linkedin.com/feed');
    try {
      await driver.wait(until.urlContains('feed'), 10000);
      log('Session restored from cache');
      return;
    } catch (e) {
      log('Cached session expired, proceeding to login');
    }
  }

  log('Starting LinkedIn login...');
  await driver.get('https://www.linkedin.com/login');

  // Wait for email field
  await driver.wait(until.elementLocated(By.id('username')), 10000);
  await driver.findElement(By.id('username')).sendKeys(process.env.LINKEDIN_EMAIL);

  await driver.findElement(By.id('password')).sendKeys(process.env.LINKEDIN_PASSWORD);

  await driver.findElement(By.css('button[type="submit"]')).click();

  // Wait for login to complete or MFA challenge
  try {
    await driver.wait(until.urlContains('feed'), 30000);
    log('Login successful');
    // Save cookies after successful login
    await saveCookies(driver);
  } catch (e) {
    log('Login may require MFA. Please complete verification manually.');
    // Wait for user to complete MFA
    await driver.wait(until.urlContains('feed'), 300000); // 5 minutes timeout
    log('MFA verification completed');
    // Save cookies after MFA
    await saveCookies(driver);
  }
}

// Process a single profile
async function processProfile(driver, url) {
  try {
    log(`Processing: ${url}`);
    await driver.get(url);

    // Wait for page to load
    await driver.sleep(2000);

    // Look for Connect button
    const connectButtons = await driver.findElements(By.xpath("//button[contains(text(), 'Connect')]"));

    if (connectButtons.length > 0) {
      // Click Connect button
      await connectButtons[0].click();
      log(`Clicked Connect for: ${url}`);

      // Wait for modal and click Send now
      try {
        await driver.wait(until.elementLocated(By.xpath("//button[contains(text(), 'Send now')]")), 5000);
        await driver.findElement(By.xpath("//button[contains(text(), 'Send now')]")).click();
        log(`Connected: ${url}`);
        return true;
      } catch (e) {
        log(`Modal not found or Send now button not available for: ${url}`);
        return false;
      }
    } else {
      log(`Skipped: ${url} (No Connect button found)`);
      return false;
    }
  } catch (error) {
    log(`Error processing ${url}: ${error.message}`);
    return false;
  }
}

// Main function
async function main() {
  const visible = process.argv.includes('--visible');
  let driver;

  try {
    // Load progress and URLs
    const lastProcessedLine = loadProgress();
    const urls = loadUrls();
    const startIndex = lastProcessedLine;
    const endIndex = Math.min(startIndex + BATCH_SIZE, urls.length);

    log(`Starting batch from line ${startIndex + 1} to ${endIndex}`);

    if (startIndex >= urls.length) {
      log('All URLs have been processed');
      return;
    }

    // Setup WebDriver
    driver = await setupDriver(visible);

    // Login
    await login(driver);

    // Process profiles
    let processedCount = 0;
    for (let i = startIndex; i < endIndex; i++) {
      const success = await processProfile(driver, urls[i]);
      if (success) {
        processedCount++;
      }
      // Update progress after each profile visit
      saveProgress(i + 1);
      // Small delay between requests to avoid rate limiting
      await driver.sleep(2000);
    }
    log(`Batch completed. Processed ${processedCount} connections. Next start line: ${endIndex + 1}`);

  } catch (error) {
    log(`Error: ${error.message}`);
  } finally {
    if (driver) {
      await driver.quit();
    }
  }
}

main().catch(console.error);
