const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Konfiguration
const SCHULPORTAL_URL = 'https://start.schulportal.hessen.de/';
const OUTPUT_FILE = path.join(__dirname, 'schedule.json');

// Login-Daten aus Umgebungsvariablen lesen (werden als GitHub Secrets gespeichert)
const USERNAME = process.env.SCHULPORTAL_USERNAME;
const PASSWORD = process.env.SCHULPORTAL_PASSWORD;

// Funktion zum Einloggen ins Schulportal
async function loginToSchulportal(page) {
  console.log('Starte Login-Prozess...');
  
  await page.goto(SCHULPORTAL_URL);
  
  // Warten bis die Login-Seite geladen ist
  await page.waitForSelector('#schulportal-login');
  
  // Login-Daten eingeben
  await page.type('#benutzername', USERNAME);
  await page.type('#passwort', PASSWORD);
  
  // Login-Button klicken
  await page.click('button[type="submit"]');
  
  // Warten bis Dashboard geladen ist
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  
  console.log('Login erfolgreich!');
}

// Funktion zum Öffnen des Kalenders
async function openCalendar(page) {
  console.log('Öffne Kalender...');
  
  // Navigiere zum Kalender (dieser Selektor muss angepasst werden)
  await page.goto('https://start.schulportal.hessen.de/kalender.php');
  
  // Warte bis Kalender geladen ist
  await page.waitForSelector('.kalender-container', { timeout: 10000 });
  
  console.log('Kalender geöffnet!');
}

// Funktion zum Extrahieren der Kalenderdaten
async function extractCalendarData(page) {
  console.log('Extrahiere Kalenderdaten...');
  
  // Extrahiere alle Termine (dieser Code muss an die Struktur der Webseite angepasst werden)
  const events = await page.evaluate(() => {
    const eventElements = document.querySelectorAll('.kalender-eintrag');
    
    return Array.from(eventElements).map(element => {
      // Diese Selektoren müssen angepasst werden
      const title = element.querySelector('.titel')?.textContent.trim() || '';
      const date = element.querySelector('.datum')?.textContent.trim() || '';
      const description = element.querySelector('.beschreibung')?.textContent.trim() || '';
      
      return {
        title,
        date,
        description
      };
    });
  });
  
  console.log(`${events.length} Termine gefunden!`);
  return events;
}

// Funktion zum Konvertieren der Kalender-Daten in das schedule.json Format
function convertToScheduleFormat(events) {
  console.log('Konvertiere Daten in schedule.json Format...');
  
  // Erstelle ein Grundgerüst der schedule.json
  const schedule = {
    "Montag": {
      "message": "📅 *TERMINÜBERSICHT FÜR DIESE WOCHE* 📅",
      "subjects": []
    },
    "Dienstag": {
      "message": "📚 *ANSTEHENDE KLAUSUREN* 📝",
      "subjects": []
    },
    "Mittwoch": {
      "message": "🌟 *MITTE DER WOCHE* 🌟",
      "subjects": []
    },
    "Donnerstag": {
      "message": "🗓️ *KOMMENDE FEIERTAGE* 🎉",
      "subjects": []
    },
    "Freitag": {
      "message": "📝 *FREITAGS-KLAUSUREN IM MAI* 📝",
      "subjects": []
    },
    "Samstag": {
      "message": "🎉 *WOCHENENDE!* 🎉",
      "subjects": []
    },
    "Sonntag": {
      "message": "🔄 *WOCHE VORAUSPLANEN* 📆",
      "subjects": []
    }
  };
  
  // Sortiere die Ereignisse nach Wochentagen
  for (const event of events) {
    // Datum parsen (Format anpassen je nach Schulportal-Format)
    const dateStr = event.date; // z.B. "25.05.2025"
    const date = new Date(
      parseInt(dateStr.split('.')[2]), // Jahr
      parseInt(dateStr.split('.')[1]) - 1, // Monat (0-basiert)
      parseInt(dateStr.split('.')[0]) // Tag
    );
    
    // Bestimme den Wochentag
    const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const dayName = days[date.getDay()];
    
    // Formatiere den Eintrag
    let entry = '';
    
    // Spezielle Formatierung je nach Ereignistyp
    if (event.title.toLowerCase().includes('klausur')) {
      entry = `📝 *${dateStr}:* ${event.title}`;
    } else if (event.title.toLowerCase().includes('ferien') || event.title.toLowerCase().includes('frei')) {
      entry = `🎊 *${dateStr}:* ${event.title} (schulfrei)`;
    } else {
      entry = `📌 *${dateStr}:* ${event.title}`;
    }
    
    // Füge Beschreibung hinzu, wenn vorhanden
    if (event.description) {
      entry += ` - ${event.description}`;
    }
    
    // Füge den Eintrag zum entsprechenden Wochentag hinzu
    if (schedule[dayName]) {
      schedule[dayName].subjects.push(entry);
    }
  }
  
  return schedule;
}

// Hauptfunktion
async function updateSchedule() {
  console.log('Starte Aktualisierung des Schulkalenders...');
  
  // Prüfen ob Login-Daten vorhanden sind
  if (!USERNAME || !PASSWORD) {
    console.error('Fehler: Login-Daten fehlen. Bitte SCHULPORTAL_USERNAME und SCHULPORTAL_PASSWORD als Umgebungsvariablen setzen.');
    process.exit(1);
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Login ins Schulportal
    await loginToSchulportal(page);
    
    // Öffne den Kalender
    await openCalendar(page);
    
    // Extrahiere die Kalenderdaten
    const events = await extractCalendarData(page);
    
    // Konvertiere die Daten ins richtige Format
    const scheduleData = convertToScheduleFormat(events);
    
    // Speichere die Daten
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(scheduleData, null, 2));
    
    console.log(`Kalenderdaten erfolgreich in ${OUTPUT_FILE} gespeichert!`);
  } catch (error) {
    console.error('Fehler bei der Aktualisierung des Kalenders:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Starte die Aktualisierung
updateSchedule(); 