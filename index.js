const fetch = require('node-fetch');
const readline = require('readline');

const discordWebhookURL = process.env['discordWebhook'];
const mainAppURL = process.env['mainAppUrl'];
const statusCheckInterval = 45 * 1000; // 45 secs
const maintenanceWaitTime = 30 * 1000; // 30 seconds
const serverCheckTimeout = 15 * 1000; // 5 seconds

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let isMainAppDown = false;
let lastUpNotificationTime = null;
let lastDownNotificationTime = null;
let isMaintenanceMode = false;
let isServerAppRunning = true;
let lastHealthStatusTime = null;

async function sendDiscordWebhook(title, description, color) {
  try {
    const response = await fetch(discordWebhookURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [
          {
            title: title,
            description: description,
            color: color,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    console.log('Message sent to Discord');
  } catch (error) {
    console.error('Error sending message to Discord:', error);
  }
}

async function checkMainApp() {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, serverCheckTimeout);

  try {
    const response = await fetch(mainAppURL, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      if (isMainAppDown) {
        console.log('Main app is back up');
        isMainAppDown = false;
        if (!isMaintenanceMode) {
          const currentTime = new Date().getTime();
          if (
            lastUpNotificationTime === null ||
            currentTime - lastUpNotificationTime > 24 * 60 * 60 * 1000
          ) {
            await sendDiscordWebhook('Main App Status', 'The main app is up and running again', 0x00ff00);
            lastUpNotificationTime = currentTime;
          }
          lastHealthStatusTime = currentTime;
        }
      } else {
        console.log('Main app is alive');
        const currentTime = new Date().getTime();
        if (
          lastHealthStatusTime === null ||
          currentTime - lastHealthStatusTime > 24 * 60 * 60 * 1000
        ) {
          await sendDiscordWebhook('Main App Status', 'The main app is up and running, >100ms response', 0x00ff00);
          lastHealthStatusTime = currentTime;
        }
      }
    } else {
      if (!isMainAppDown) {
        console.log('Main app is down');
        isMainAppDown = true;
        if (!isMaintenanceMode) {
          const currentTime = new Date().getTime();
          if (
            lastDownNotificationTime === null ||
            currentTime - lastDownNotificationTime > 12 * 60 * 60 * 1000
          ) {
            await sendDiscordWebhook('Main App Status', 'The main app is down', 0xff0000);
            lastDownNotificationTime = currentTime;
          }
          lastHealthStatusTime = null;
        }
      }
    }
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      console.error('Error fetching main app: Request timed out');
    } else {
      console.error('Error fetching main app:', error);
    }
  }
}

async function handleUserInput(input) {
  if (input.trim().toLowerCase() === 'maintenance') {
    if (!isMaintenanceMode) {
      isMaintenanceMode = true;
      if (isServerAppRunning) {
        try {
          const response = await fetch(mainAppURL + '/maintenance', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ maintenance: true }),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          console.log('Main server app has been shut down');
          isServerAppRunning = false;
          await sendDiscordWebhook(
            'Backend under maintenance',
            'Expected maintenance is currently taking place, application forms closed temporarily'
          );

          // Perform a health check 5 seconds after the maintenance has started
          setTimeout(async () => {
            console.log('Performing health check after maintenance start');
            await checkMainApp();
            await sendDiscordWebhook('Main App Status', 'The main app is down', 0xff0000);
          }, 5 * 1000);

        } catch (error) {
          console.error('Error stopping main server app:', error);
        }
      }
    } else {
      console.log('Maintenance mode is already enabled');
    }
  } else if (input.trim().toLowerCase() === 'maintenance done') {
    if (isMaintenanceMode) {
      setTimeout(async () => {
        isMaintenanceMode = false;
        console.log('Maintenance mode has ended');
        if (!isMainAppDown) {
          await startServerApp();
          console.log('Main server app has been restarted');
          await sendDiscordWebhook('Maintenance Ended', 'The maintenance has been completed, and the main app is up and running');
          sendDiscordWebhook('Main App Status', 'The main app is up');
          const currentTime = new Date().getTime();
          if (
            lastHealthStatusTime === null ||
            currentTime - lastHealthStatusTime > 24 * 60 * 60 * 1000
          ) {
            sendDiscordWebhook('Main App Status', 'The main app is up');
            lastHealthStatusTime = currentTime;
          }
        } else {
          console.log('Main app is still down');
        }
      }, maintenanceWaitTime);
    } else {
      console.log('Maintenance mode is not enabled');
    }
  } else {
    console.log('Invalid input. Type "maintenance" or "maintenance done"');
  }
}

async function startServerApp() {
  try {
    console.log('Sending request to start server app');
    const response = await fetch(mainAppURL + '/start', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    console.log('Main server app has been started');
    isServerAppRunning = true;
  } catch (error) {
    console.error('Error starting main server app:', error);
  }
}

rl.on('line', (input) => {
  handleUserInput(input);
});

(async () => {
  // Send a status message when the status app is started
  await sendDiscordWebhook('Status app is up', 'The status app is up and running');

  // Check the main app status at the start
  await checkMainApp();

  // Check the main app periodically
  setInterval(checkMainApp, statusCheckInterval);
})();
