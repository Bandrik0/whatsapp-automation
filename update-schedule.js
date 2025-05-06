const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Konfiguration
const SCHULPORTAL_URL = 'https://start.schulportal.hessen.de/';
const OUTPUT_FILE = path.join(__dirname, 'schedule.json');
const CSV_FILE = process.env.CSV_FILE || path.join(__dirname, 'schulkalender.csv');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// Login-Daten aus Umgebungsvariablen lesen (werden als GitHub Secrets gespeichert)
const USERNAME = process.env.SCHULPORTAL_USERNAME;
const PASSWORD = process.env.SCHULPORTAL_PASSWORD;

// Alternative Funktion, die direkt aus der CSV-Datei liest
async function loadFromCSV(filePath) {
  console.log(`Lade Daten aus CSV-Datei: ${filePath}`);
  
  return new Promise((resolve, reject) => {
    const results = [];
    
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`CSV-Datei nicht gefunden: ${filePath}`));
    }
    
    fs.createReadStream(filePath)
      .pipe(csv({
        separator: ';',
        headers: ['Titel', 'Art', 'Von_Datum', 'Von_Uhrzeit', 'Bis_Datum', 'Bis_Uhrzeit', 'Beschreibung', 'Ort', 'Verantwortlich'],
        skipLines: 1
      }))
      .on('data', (data) => results.push(data))
      .on('end', () => {
        console.log(`${results.length} Einträge aus CSV geladen.`);
        resolve(results);
      })
      .on('error', (error) => reject(error));
  });
}

// Funktion zum Einloggen ins Schulportal mit detaillierter Browserautomatisierung
async function autoLoginAndDownload() {
  console.log('Starte automatisierte Schulportal-Sitzung...');
  
  // Stellen Sie sicher, dass das Download-Verzeichnis existiert
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
  
  const browser = await puppeteer.launch({
    headless: false, // Sichtbar für Debugging
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null
  });
  
  try {
    const page = await browser.newPage();
    
    // Download-Verhalten konfigurieren
    await page._client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR
    });
    
    // Mehr Zeit für Operationen geben
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);
    
    console.log('Navigiere zum Schulportal...');
    await page.goto(SCHULPORTAL_URL, { waitUntil: 'networkidle2' });
    
    // Warten und Screenshots für Debugging machen
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'login-page.png') });
    
    console.log('Suche Login-Elemente...');
    
    // Flexibler Login-Prozess, versucht verschiedene Selektoren
    try {
      // Erster Versuch: Standard-Selektoren
      if (await page.$('#benutzername')) {
        console.log('Gefunden: Standard-Login-Formular');
        await page.type('#benutzername', USERNAME);
        await page.type('#passwort', PASSWORD);
        await page.click('button[type="submit"]');
      } 
      // Zweiter Versuch: Alternative Selektoren
      else if (await page.$('input[name="user"]')) {
        console.log('Gefunden: Alternatives Login-Formular');
        await page.type('input[name="user"]', USERNAME);
        await page.type('input[name="password"]', PASSWORD);
        await page.click('input[type="submit"]');
      }
      // Dritter Versuch: Suche nach iFrame
      else {
        console.log('Suche nach Login iFrame...');
        const frames = page.frames();
        let loginFrame = null;
        
        for (const frame of frames) {
          if (await frame.$('#benutzername') || await frame.$('input[name="user"]')) {
            loginFrame = frame;
            break;
          }
        }
        
        if (loginFrame) {
          console.log('Login im iFrame gefunden');
          if (await loginFrame.$('#benutzername')) {
            await loginFrame.type('#benutzername', USERNAME);
            await loginFrame.type('#passwort', PASSWORD);
            await loginFrame.click('button[type="submit"]');
          } else {
            await loginFrame.type('input[name="user"]', USERNAME);
            await loginFrame.type('input[name="password"]', PASSWORD);
            await loginFrame.click('input[type="submit"]');
          }
        } else {
          console.log('Kein Login-Formular gefunden, mache Screenshot...');
          await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'login-not-found.png') });
          throw new Error('Login-Formular nicht gefunden');
        }
      }
    } catch (error) {
      console.error('Fehler bei der Login-Suche:', error);
      await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'login-error.png') });
      throw error;
    }
    
    // Warten auf die Navigation nach dem Login
    console.log('Warte auf Navigation nach Login...');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'after-login.png') });
    
    // Versuche, den Kalender-Button zu finden und zu klicken
    console.log('Suche nach Zugang zum Kalender...');
    
    // Verschiedene mögliche Selektoren für Kalender durchprobieren
    const calendarSelectors = [
      'a[href*="kalender"]',
      'a[href*="Kalender"]',
      'a:contains("Kalender")',
      'a:contains("kalender")',
      '.menu a[href*="kalender"]',
      '#menu a[href*="kalender"]'
    ];
    
    let calendarLinkFound = false;
    
    for (const selector of calendarSelectors) {
      try {
        if (await page.$(selector)) {
          console.log(`Kalender-Link gefunden mit Selektor: ${selector}`);
          await page.click(selector);
          calendarLinkFound = true;
          break;
        }
      } catch (e) {
        console.log(`Selektor nicht gefunden: ${selector}`);
      }
    }
    
    // Wenn kein direkter Link gefunden wurde, versuche direkten Zugriff auf die URL
    if (!calendarLinkFound) {
      console.log('Kein Kalender-Link gefunden, versuche direkte URL...');
      await page.goto(`${SCHULPORTAL_URL}kalender.php`, { waitUntil: 'networkidle2' });
    }
    
    // Nach Navigation zum Kalender
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'calendar-page.png') });
    
    // Versuche, den Exportieren/Download-Button zu finden
    console.log('Suche nach Export-Funktion...');
    
    const exportSelectors = [
      'a[href*="export"]',
      'a[href*="Export"]',
      'button:contains("Export")',
      'button:contains("exportieren")',
      'a:contains("CSV")',
      'button:contains("CSV")'
    ];
    
    let exportLinkFound = false;
    
    for (const selector of exportSelectors) {
      try {
        if (await page.$(selector)) {
          console.log(`Export-Link gefunden mit Selektor: ${selector}`);
          await page.click(selector);
          exportLinkFound = true;
          break;
        }
      } catch (e) {
        console.log(`Export-Selektor nicht gefunden: ${selector}`);
      }
    }
    
    // Wenn Export-Link nicht gefunden, versuche zu prüfen, ob wir bereits eine Fehlermeldung sehen
    if (!exportLinkFound) {
      console.log('Prüfe auf Fehlermeldungen...');
      const pageContent = await page.content();
      
      if (pageContent.includes('nicht freigeschaltet') || pageContent.includes('Fehler')) {
        console.log('Fehlermeldung vom Schulportal erkannt. Versuche alternative Methode...');
        
        // Prüfe auf "Zurück zur Startseite"-Link
        if (await page.$('a:contains("Zurück zur Startseite")')) {
          console.log('Navigiere zurück zur Startseite...');
          await page.click('a:contains("Zurück zur Startseite")');
          await page.waitForNavigation({ waitUntil: 'networkidle2' });
        }
        
        // Suche nach einem Vertretungsplan-Link
        console.log('Suche nach Vertretungsplan...');
        const substSelectors = [
          'a[href*="vertretungsplan"]',
          'a[href*="Vertretungsplan"]',
          'a:contains("Vertretungsplan")',
          'a:contains("vertretungsplan")'
        ];
        
        for (const selector of substSelectors) {
          try {
            if (await page.$(selector)) {
              console.log(`Vertretungsplan-Link gefunden mit Selektor: ${selector}`);
              await page.click(selector);
              await page.waitForNavigation({ waitUntil: 'networkidle2' });
              await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'vertretungsplan.png') });
              break;
            }
          } catch (e) {
            console.log(`Vertretungsplan-Selektor nicht gefunden: ${selector}`);
          }
        }
      }
    }
    
    // Warte auf mögliche Downloads
    console.log('Warte auf Downloads...');
    await page.waitForTimeout(5000);
    
    // Schließe den Browser
    await browser.close();
    
    // Prüfe, ob Dateien heruntergeladen wurden
    const downloadedFiles = fs.readdirSync(DOWNLOAD_DIR);
    const csvFiles = downloadedFiles.filter(file => file.endsWith('.csv'));
    
    if (csvFiles.length > 0) {
      console.log(`CSV-Datei(en) gefunden: ${csvFiles.join(', ')}`);
      // Neueste CSV-Datei verwenden
      const latestCSV = csvFiles.sort().pop();
      return path.join(DOWNLOAD_DIR, latestCSV);
    } else {
      console.log('Keine CSV-Dateien heruntergeladen. Verwende vorhandene CSV-Datei...');
      return CSV_FILE;
    }
  } catch (error) {
    console.error('Fehler bei der automatisierten Sitzung:', error);
    await browser.close();
    return CSV_FILE; // Fallback zur vorhandenen CSV-Datei
  }
}

// Funktion zum Konvertieren der CSV-Daten in das schedule.json Format
function convertCSVToScheduleFormat(csvData) {
  console.log('Konvertiere CSV-Daten in schedule.json Format...');
  
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
      "message": "📝 *FREITAGS-KLAUSUREN* 📝",
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
  
  // Verarbeite jeden Eintrag aus der CSV
  for (const entry of csvData) {
    try {
      // Formatiere das Datum (Von_Datum: "01.01.2025")
      const dateStr = entry.Von_Datum;
      if (!dateStr || dateStr.split('.').length !== 3) {
        console.log(`Überspringe Eintrag ohne gültiges Datum: ${entry.Titel}`);
        continue;
      }
      
      const date = new Date(
        parseInt(dateStr.split('.')[2]), // Jahr
        parseInt(dateStr.split('.')[1]) - 1, // Monat (0-basiert)
        parseInt(dateStr.split('.')[0]) // Tag
      );
      
      // Bestimme den Wochentag
      const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      const dayName = days[date.getDay()];
      
      // Formatiere die Uhrzeit, falls vorhanden
      let timeStr = '';
      if (entry.Von_Uhrzeit && entry.Von_Uhrzeit !== '00:00' && entry.Bis_Uhrzeit && entry.Bis_Uhrzeit !== '23:59') {
        timeStr = ` (${entry.Von_Uhrzeit}-${entry.Bis_Uhrzeit})`;
      }
      
      // Formatiere den Eintrag je nach Art
      let formattedEntry = '';
      
      if (entry.Art === 'Klausuren' || entry.Titel.toLowerCase().includes('klausur')) {
        formattedEntry = `📝 *${dateStr}${timeStr}:* ${entry.Titel}`;
      } else if (entry.Art === 'Ferien & freie Tage' || entry.Titel.toLowerCase().includes('ferien') || entry.Titel.toLowerCase().includes('frei')) {
        formattedEntry = `🎊 *${dateStr}:* ${entry.Titel} (schulfrei)`;
      } else {
        formattedEntry = `📌 *${dateStr}${timeStr}:* ${entry.Titel}`;
      }
      
      // Füge Beschreibung und Ort hinzu, wenn vorhanden
      if (entry.Beschreibung) {
        formattedEntry += ` - ${entry.Beschreibung}`;
      }
      
      if (entry.Ort) {
        formattedEntry += ` (${entry.Ort})`;
      }
      
      // Füge den Eintrag zum entsprechenden Wochentag hinzu
      if (schedule[dayName]) {
        schedule[dayName].subjects.push(formattedEntry);
      } else {
        console.log(`Unbekannter Wochentag für Datum ${dateStr}: ${dayName}`);
      }
    } catch (error) {
      console.error(`Fehler beim Verarbeiten eines Eintrags: ${error.message}`, entry);
    }
  }
  
  return schedule;
}

// Hauptfunktion
async function updateSchedule() {
  console.log('Starte Aktualisierung des Schulkalenders...');
  
  try {
    let csvFilePath = CSV_FILE;
    
    // Wenn Login-Daten vorhanden sind, versuche automatisierte Sitzung
    if (USERNAME && PASSWORD) {
      console.log('Login-Daten gefunden, versuche automatisierte Sitzung...');
      try {
        csvFilePath = await autoLoginAndDownload();
      } catch (loginError) {
        console.error('Fehler bei automatisierter Sitzung:', loginError);
        console.log('Verwende vorhandene CSV-Datei als Fallback...');
      }
    } else {
      console.log('Keine Login-Daten gefunden, verwende vorhandene CSV-Datei...');
    }
    
    // Versuche, die Daten aus der CSV-Datei zu laden
    const csvData = await loadFromCSV(csvFilePath);
    
    // Konvertiere die Daten ins richtige Format
    const scheduleData = convertCSVToScheduleFormat(csvData);
    
    // Speichere die Daten
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(scheduleData, null, 2));
    
    console.log(`Kalenderdaten erfolgreich in ${OUTPUT_FILE} gespeichert!`);
  } catch (error) {
    console.error('Fehler bei der Aktualisierung des Kalenders:', error);
    process.exit(1);
  }
}

// Starte die Aktualisierung
updateSchedule(); 