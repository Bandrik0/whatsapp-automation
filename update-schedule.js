const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Konfiguration
const SCHULPORTAL_URL = 'https://login.schulportal.hessen.de/?url=aHR0cHM6Ly9jb25uZWN0LnNjaHVscG9ydGFsLmhlc3Nlbi5kZS8=&skin=sp&i=6292';
const OUTPUT_FILE = path.join(__dirname, 'schedule.json');
const CSV_FILE = process.env.CSV_FILE || path.join(__dirname, 'schulkalender.csv');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const VERTRETUNG_FILE = path.join(__dirname, 'vertretung.json');

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
    headless: true, // Headless für Server-Betrieb
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null
  });
  
  try {
    const page = await browser.newPage();
    
    // Konfiguriere Download-Verhalten - moderne Methode
    await page._client?.send?.('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR
    }).catch(() => {
      // Falls die Methode nicht existiert, verwende die alternative Methode
      console.log('Verwende alternative Download-Konfiguration...');
      const client = page.target().createCDPSession?.();
      if (client) {
        return client.send('Page.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: DOWNLOAD_DIR
        });
      }
      // Wenn keine der Methoden funktioniert, fahre trotzdem fort
      console.log('Download-Konfiguration konnte nicht gesetzt werden, fahre fort...');
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
      // Prüfen, ob wir uns auf der Login-Auswahl-Seite befinden und wenn ja, "Login mit Schulbezug" auswählen
      const loginWithSchoolBtn = await page.$('a[data-target="#loginSchool"]');
      if (loginWithSchoolBtn) {
        console.log('Login-Auswahl-Seite gefunden, wähle "Login mit Schulbezug"');
        await loginWithSchoolBtn.click();
        await page.waitForTimeout(1000);
      }
      
      // Erster Versuch: Standard-Selektoren
      if (await page.$('#inputSchulportalpwd')) {
        console.log('Gefunden: Schulportal-Login-Formular');
        // Zuerst Benutzername eingeben
        await page.type('#inputEmail', USERNAME);
        // Dann Passwort
        await page.type('#inputSchulportalpwd', PASSWORD);
        // Login-Button klicken
        await page.click('button[type="submit"]');
      } 
      // Zweiter Versuch: Alte Login-Formular-Selektoren
      else if (await page.$('#benutzername')) {
        console.log('Gefunden: Standard-Login-Formular');
        await page.type('#benutzername', USERNAME);
        await page.type('#passwort', PASSWORD);
        await page.click('button[type="submit"]');
      } 
      // Dritter Versuch: Alternative Selektoren
      else if (await page.$('input[name="user"]')) {
        console.log('Gefunden: Alternatives Login-Formular');
        await page.type('input[name="user"]', USERNAME);
        await page.type('input[name="password"]', PASSWORD);
        
        // Versuche verschiedene Submit-Button-Selektoren
        const submitSelectors = [
          'input[type="submit"]',
          'button[type="submit"]',
          'button.btn-login',
          'button.login-button',
          'button:contains("Anmelden")',
          'input.btn',
          '.btn-primary'
        ];
        
        let buttonClicked = false;
        for (const selector of submitSelectors) {
          if (await page.$(selector)) {
            console.log(`Submit-Button gefunden: ${selector}`);
            await page.click(selector);
            buttonClicked = true;
            break;
          }
        }
        
        if (!buttonClicked) {
          console.log('Kein Submit-Button gefunden, versuche Enter zu drücken...');
          await page.keyboard.press('Enter');
        }
      }
      // Vierter Versuch: Suche nach iFrame
      else {
        console.log('Suche nach Login iFrame...');
        const frames = page.frames();
        let loginFrame = null;
        
        for (const frame of frames) {
          if (await frame.$('#inputEmail') || await frame.$('#benutzername') || await frame.$('input[name="user"]')) {
            loginFrame = frame;
            break;
          }
        }
        
        if (loginFrame) {
          console.log('Login im iFrame gefunden');
          if (await loginFrame.$('#inputEmail')) {
            await loginFrame.type('#inputEmail', USERNAME);
            await loginFrame.type('#inputSchulportalpwd', PASSWORD);
            await loginFrame.click('button[type="submit"]');
          } else if (await loginFrame.$('#benutzername')) {
            await loginFrame.type('#benutzername', USERNAME);
            await loginFrame.type('#passwort', PASSWORD);
            await loginFrame.click('button[type="submit"]');
          } else {
            await loginFrame.type('input[name="user"]', USERNAME);
            await loginFrame.type('input[name="password"]', PASSWORD);
            
            // Versuche verschiedene Submit-Button-Selektoren im iFrame
            const submitSelectors = [
              'input[type="submit"]',
              'button[type="submit"]',
              'button.btn-login',
              'button.login-button',
              'button:contains("Anmelden")',
              'input.btn',
              '.btn-primary'
            ];
            
            let buttonClicked = false;
            for (const selector of submitSelectors) {
              if (await loginFrame.$(selector)) {
                console.log(`Submit-Button im iFrame gefunden: ${selector}`);
                await loginFrame.click(selector);
                buttonClicked = true;
                break;
              }
            }
            
            if (!buttonClicked) {
              console.log('Kein Submit-Button im iFrame gefunden, versuche Enter zu drücken...');
              await loginFrame.focus('input[name="password"]');
              await page.keyboard.press('Enter');
            }
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
    
    // Warten nach dem Login ohne auf Navigation zu warten
    console.log('Login-Button geklickt, warte auf Session-Erstellung...');
    // Längere Wartezeit, um dem Login Zeit zu geben
    await page.waitForTimeout(5000);
    
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'after-login.png') });
    
    // Prüfen, ob wir eingeloggt sind oder eine Fehlermeldung angezeigt wird
    const errorElement = await page.$('.alert-danger, .error-message, .error, .alert-error');
    if (errorElement) {
      const errorText = await page.evaluate(el => el.textContent, errorElement);
      console.log('Login-Fehler erkannt:', errorText);
      throw new Error(`Login-Fehler: ${errorText}`);
    }
    
    // Sammle Daten für Rückgabe
    const results = {
      calendarFile: null,
      vertretungsplan: null
    };
    
    // Nach dem Login direkt zu bestimmten URLs navigieren
    console.log('Versuche direkt zur Startseite zu navigieren...');
    
    try {
      // Liste möglicher URLs, die nach Login funktionieren könnten
      const possibleStartpages = [
        'https://connect.schulportal.hessen.de/',
        'https://start.schulportal.hessen.de/',
        'https://portal.schulportal.hessen.de/'
      ];
      
      let pageLoaded = false;
      
      // Versuche alle möglichen Startseiten
      for (const startpage of possibleStartpages) {
        if (pageLoaded) break;
        
        try {
          console.log(`Versuche Navigation zu: ${startpage}`);
          await page.goto(startpage, { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
          });
          
          // Kurz warten, um zu sehen, ob die Seite erfolgreich geladen wurde
          await page.waitForTimeout(2000);
          
          // Prüfe, ob wir auf einer funktionierenden Seite gelandet sind
          const pageTitle = await page.title();
          console.log(`Aktuelle Seite Titel: ${pageTitle}`);
          
          // Mache einen Screenshot
          await page.screenshot({ path: path.join(DOWNLOAD_DIR, `startpage-${startpage.replace(/[^\w]/g, '_')}.png`) });
          
          pageLoaded = true;
        } catch (e) {
          console.log(`Navigation zu ${startpage} fehlgeschlagen: ${e.message}`);
        }
      }
    } catch (e) {
      console.log('Alle Navigationsversuche fehlgeschlagen:', e.message);
      console.log('Versuche trotzdem fortzufahren...');
    }
    
    // 1. Zuerst den Kalender versuchen - direkte URL
    console.log('Versuche direkt zum Kalender zu navigieren...');
    
    try {
      // Versuche verschiedene mögliche Kalender-URLs
      const calendarUrls = [
        'https://connect.schulportal.hessen.de/kalender.php',
        'https://start.schulportal.hessen.de/kalender.php',
        'https://portal.schulportal.hessen.de/kalender.php'
      ];
      
      let calendarLoaded = false;
      
      for (const calendarUrl of calendarUrls) {
        if (calendarLoaded) break;
        
        try {
          console.log(`Versuche Navigation zu Kalender: ${calendarUrl}`);
          await page.goto(calendarUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
          });
          
          await page.waitForTimeout(2000);
          await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'calendar-page.png') });
          
          // Prüfe, ob wir auf der Kalenderseite sind
          const pageContent = await page.content();
          if (pageContent.includes('Kalender') || pageContent.includes('calendar')) {
            console.log('Kalenderseite erfolgreich geladen');
            calendarLoaded = true;
          }
        } catch (e) {
          console.log(`Navigation zu ${calendarUrl} fehlgeschlagen: ${e.message}`);
        }
      }
    } catch (error) {
      console.error('Fehler beim Zugriff auf Kalender:', error);
    }
    
    // 2. Dann den Vertretungsplan versuchen - direkte URL
    console.log('Versuche direkt zum Vertretungsplan zu navigieren...');
    
    try {
      // Versuche verschiedene mögliche Vertretungsplan-URLs
      const substUrls = [
        'https://connect.schulportal.hessen.de/vertretungsplan.php',
        'https://start.schulportal.hessen.de/vertretungsplan.php',
        'https://portal.schulportal.hessen.de/vertretungsplan.php'
      ];
      
      let substLoaded = false;
      
      for (const substUrl of substUrls) {
        if (substLoaded) break;
        
        try {
          console.log(`Versuche Navigation zu Vertretungsplan: ${substUrl}`);
          await page.goto(substUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
          });
          
          await page.waitForTimeout(2000);
          await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'vertretungsplan-page.png') });
          
          // Prüfe, ob wir auf der Vertretungsplan-Seite sind
          const pageContent = await page.content();
          if (pageContent.includes('Vertretung') || pageContent.includes('Vertretungsplan')) {
            console.log('Vertretungsplan-Seite erfolgreich geladen');
            substLoaded = true;
          }
        } catch (e) {
          console.log(`Navigation zu ${substUrl} fehlgeschlagen: ${e.message}`);
        }
      }
      
      // Nur fortfahren, wenn die Seite erfolgreich geladen wurde
      if (substLoaded) {
        // Extrahiere Vertretungsplan-Daten direkt aus der Seite
        console.log('Versuche Vertretungsplandaten zu extrahieren...');
      
        const vertretungData = await page.evaluate(() => {
          // Suche nach Tabellen, die den Vertretungsplan enthalten könnten
          const tables = Array.from(document.querySelectorAll('table'));
          const data = [];
          
          // Suche nach Datumsangaben
          const dateElements = document.querySelectorAll('h2, h3, h4, .date, .day');
          let currentDate = '';
          
          for (const elem of dateElements) {
            if (elem.textContent.match(/\d{1,2}\.\d{1,2}\.\d{4}/) ||
                elem.textContent.match(/Montag|Dienstag|Mittwoch|Donnerstag|Freitag/)) {
              currentDate = elem.textContent.trim();
              break;
            }
          }
          
          // Durchlaufe alle Tabellen und suche nach Vertretungsdaten
          for (const table of tables) {
            // Versuche Tabellen-Header zu identifizieren
            const headers = Array.from(table.querySelectorAll('th, thead td'))
              .map(th => th.textContent.trim());
            
            // Prüfe, ob es sich um eine Vertretungsplan-Tabelle handeln könnte
            if (headers.some(h => 
                h.includes('Klasse') || 
                h.includes('Stunde') || 
                h.includes('Fach') || 
                h.includes('Vertretung') ||
                h.includes('Raum'))) {
              
              // Extrahiere die Zeilen
              const rows = Array.from(table.querySelectorAll('tbody tr'));
              
              for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('td'))
                  .map(cell => cell.textContent.trim());
                
                // Wenn wir genug Zellen haben und mindestens eine nicht leer ist
                if (cells.length >= 3 && cells.some(cell => cell.length > 0)) {
                  // Extrahiere relevante Daten basierend auf Position oder Header
                  const rowData = {};
                  
                  // Versuche Daten zuzuordnen (Positionen können variieren)
                  headers.forEach((header, index) => {
                    if (index < cells.length) {
                      rowData[header] = cells[index];
                    }
                  });
                  
                  // Füge das Datum hinzu
                  rowData.Datum = currentDate;
                  
                  // Füge diese Zeile zu den Daten hinzu
                  data.push(rowData);
                }
              }
            }
          }
          
          // Wenn keine strukturierten Daten gefunden wurden, versuche es mit einem einfacheren Ansatz
          if (data.length === 0) {
            // Suche nach Text, der auf Vertretungen hinweisen könnte
            const content = document.body.textContent;
            
            if (content.includes('Vertretung') || content.includes('Ausfall') || 
                content.includes('Entfall') || content.includes('Vertretungsplan')) {
              
              // Extrahiere den relevanten Teil des Textes
              const relevantText = content.split('\n')
                .filter(line => 
                    line.trim().length > 0 && 
                    (line.includes('Klasse') || 
                     line.includes('Stunde') || 
                     line.includes('Vertretung') || 
                     line.includes('Ausfall')))
                .join('\n');
              
              data.push({
                rawText: relevantText,
                Datum: currentDate
              });
            }
          }
          
          return data;
        });
        
        // Speichere Vertretungsplan-Daten
        if (vertretungData && vertretungData.length > 0) {
          console.log(`${vertretungData.length} Vertretungseinträge gefunden.`);
          results.vertretungsplan = vertretungData;
        } else {
          console.log('Keine Vertretungsplan-Daten gefunden oder Zugriff nicht möglich.');
        }
      }
    } catch (error) {
      console.error('Fehler beim Zugriff auf Vertretungsplan:', error);
    }
    
    // Warte auf mögliche Downloads und schließe den Browser
    console.log('Warte auf Downloads...');
    await page.waitForTimeout(5000);
    await browser.close();
    
    // Prüfe, ob CSV-Dateien heruntergeladen wurden
    const downloadedFiles = fs.readdirSync(DOWNLOAD_DIR);
    const csvFiles = downloadedFiles.filter(file => file.endsWith('.csv'));
    
    if (csvFiles.length > 0) {
      console.log(`CSV-Datei(en) gefunden: ${csvFiles.join(', ')}`);
      // Neueste CSV-Datei verwenden
      const latestCSV = csvFiles.sort().pop();
      results.calendarFile = path.join(DOWNLOAD_DIR, latestCSV);
    } else {
      console.log('Keine CSV-Dateien heruntergeladen. Verwende vorhandene CSV-Datei...');
      results.calendarFile = CSV_FILE;
    }
    
    return results;
  } catch (error) {
    console.error('Fehler bei der automatisierten Sitzung:', error);
    await browser.close();
    // Fallback-Werte
    return {
      calendarFile: CSV_FILE,
      vertretungsplan: null
    };
  }
}

// Funktion zum Konvertieren der CSV-Daten in das schedule.json Format
function convertCSVToScheduleFormat(csvData, vertretungsplan) {
  console.log('Konvertiere CSV-Daten in schedule.json Format...');
  
  // Erstelle ein Grundgerüst der schedule.json
  const schedule = {
    "Montag": {
      "message": "📅 *TERMINE DIESE WOCHE* 📆",
      "subjects": []
    },
    "Dienstag": {
      "message": "📚 *AKTUELLE TERMINE & KLAUSUREN* 📝",
      "subjects": []
    },
    "Mittwoch": {
      "message": "🌟 *AKTUELLE TERMINE & INFOS* 📋",
      "subjects": []
    },
    "Donnerstag": {
      "message": "🗓️ *WICHTIGE TERMINE & FEIERTAGE* 🎉",
      "subjects": []
    },
    "Freitag": {
      "message": "📝 *WOCHENABSCHLUSS & KOMMENDE TERMINE* 📆",
      "subjects": []
    }
  };
  
  // Füge Vertretungsplan-Informationen hinzu, wenn vorhanden
  if (vertretungsplan && vertretungsplan.length > 0) {
    console.log('Füge Vertretungsplan-Daten hinzu...');
    
    // Gruppiere nach Datum/Tag
    const groupedData = {};
    
    vertretungsplan.forEach(entry => {
      let day = '';
      if (entry.Datum) {
        // Versuche Tag aus Datum zu extrahieren
        const dateParts = entry.Datum.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (dateParts) {
          const date = new Date(
            parseInt(dateParts[3]), // Jahr
            parseInt(dateParts[2]) - 1, // Monat (0-basiert)
            parseInt(dateParts[1]) // Tag
          );
          const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
          const dayIndex = date.getDay();
          // Nur Montag bis Freitag (1-5) verwenden
          if (dayIndex >= 1 && dayIndex <= 5) {
            day = days[dayIndex];
          } else {
            // Für Wochenendtage auf Montag setzen
            day = 'Montag';
          }
        }
      }
      
      // Wenn immer noch kein Tag gefunden, verwende den aktuellen Tag
      if (!day) {
        const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        const dayIndex = new Date().getDay();
        // Nur Montag bis Freitag (1-5) verwenden, sonst Montag
        if (dayIndex >= 1 && dayIndex <= 5) {
          day = days[dayIndex];
        } else {
          day = 'Montag';
        }
      }
      
      // Initialisiere Gruppe falls noch nicht vorhanden
      if (!groupedData[day]) {
        groupedData[day] = [];
      }
      
      groupedData[day].push(entry);
    });
    
    // Formatiere die Vertretungsplan-Einträge und füge sie dem Schedule hinzu
    for (const [day, entries] of Object.entries(groupedData)) {
      if (schedule[day]) {
        // Füge einen Trenner ein, wenn bereits Einträge vorhanden sind
        if (schedule[day].subjects.length > 0) {
          schedule[day].subjects.push('-------------------------');
        }
        
        // Füge einen Vertretungsplan-Header hinzu
        schedule[day].subjects.push('🔄 *VERTRETUNGEN HEUTE:*');
        
        // Füge jeden Eintrag hinzu
        entries.forEach(entry => {
          let formattedEntry = '';
          
          // Rawtext Eintrag
          if (entry.rawText) {
            formattedEntry = `📝 ${entry.rawText.substring(0, 100)}${entry.rawText.length > 100 ? '...' : ''}`;
          } 
          // Strukturierter Eintrag
          else {
            const klasse = entry.Klasse || entry.klasse || '';
            const stunde = entry.Stunde || entry.stunde || '';
            const fach = entry.Fach || entry.fach || '';
            const lehrer = entry.Lehrer || entry.lehrer || '';
            const raum = entry.Raum || entry.raum || '';
            const info = entry.Info || entry.info || entry.Hinweis || entry.hinweis || '';
            
            if (klasse || stunde || fach || lehrer || raum) {
              formattedEntry = `📝 `;
              
              if (klasse) formattedEntry += `*Klasse ${klasse}*: `;
              if (stunde) formattedEntry += `${stunde}. Std. `;
              if (fach) formattedEntry += `${fach} `;
              if (lehrer) formattedEntry += `(${lehrer}) `;
              if (raum) formattedEntry += `in Raum ${raum} `;
              if (info) formattedEntry += `- ${info}`;
            }
          }
          
          if (formattedEntry) {
            schedule[day].subjects.push(formattedEntry);
          }
        });
      }
    }
    
    // Speichere den Vertretungsplan separat
    fs.writeFileSync(VERTRETUNG_FILE, JSON.stringify(vertretungsplan, null, 2));
  }
  
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
      
      // Filtere nur aktuelle und zukünftige Termine
      const heute = new Date();
      // Setze die Zeit auf 00:00:00 für korrekten Datumsvergleich
      heute.setHours(0, 0, 0, 0);
      
      // Überspringe Termine, die mehr als 7 Tage in der Vergangenheit liegen
      const sieben_tage_zuvor = new Date(heute);
      sieben_tage_zuvor.setDate(heute.getDate() - 7);
      
      if (date < sieben_tage_zuvor) {
        console.log(`Überspringe Termin in der Vergangenheit: ${dateStr} - ${entry.Titel}`);
        continue;
      }
      
      // Bestimme den Wochentag
      const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      const dayIndex = date.getDay();
      
      // Überspringe Termine am Wochenende oder verschiebe sie auf Montag
      let dayName;
      if (dayIndex === 0 || dayIndex === 6) {
        console.log(`Termin fällt auf Wochenende, verschiebe auf Montag: ${dateStr} - ${entry.Titel}`);
        dayName = 'Montag';
      } else {
        dayName = days[dayIndex];
      }
      
      // Formatiere die Uhrzeit, falls vorhanden
      let timeStr = '';
      if (entry.Von_Uhrzeit && entry.Von_Uhrzeit !== '00:00' && entry.Bis_Uhrzeit && entry.Bis_Uhrzeit !== '23:59') {
        timeStr = ` (${entry.Von_Uhrzeit}-${entry.Bis_Uhrzeit})`;
      }
      
      // Formatiere das Datum im Format TT.MM.YYYY
      const formattedDateStr = `${dateStr.padStart(10, '0')}`;
      
      // Formatiere den Eintrag je nach Art mit besserem Datum und Zeit
      let formattedEntry = '';
      
      if (entry.Art === 'Klausuren' || entry.Titel.toLowerCase().includes('klausur')) {
        formattedEntry = `📝 *${formattedDateStr}${timeStr}:* ${entry.Titel}`;
      } else if (entry.Art === 'Ferien & freie Tage' || entry.Titel.toLowerCase().includes('ferien') || entry.Titel.toLowerCase().includes('frei')) {
        formattedEntry = `🎊 *${formattedDateStr}:* ${entry.Titel} (schulfrei)`;
      } else {
        formattedEntry = `📌 *${formattedDateStr}${timeStr}:* ${entry.Titel}`;
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
  
  // Sortiere die Termine nach Datum (extrahiere Datum aus den formatierten Einträgen)
  for (const day in schedule) {
    if (schedule[day].subjects.length > 0) {
      schedule[day].subjects.sort((a, b) => {
        // Extrahiere Datum aus den Einträgen (Format: "📝 *01.01.2025 (08:00-09:30):* Titel")
        const getDateFromEntry = (entry) => {
          const match = entry.match(/\*(\d{2}\.\d{2}\.\d{4})/);
          if (match && match[1]) {
            const [day, month, year] = match[1].split('.');
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          }
          return new Date(0); // Fallback
        };
        
        const dateA = getDateFromEntry(a);
        const dateB = getDateFromEntry(b);
        
        return dateA - dateB;
      });
    }
  }
  
  return schedule;
}

// Hauptfunktion
async function updateSchedule() {
  console.log('Starte Aktualisierung des Schulkalenders...');
  
  try {
    let csvFilePath = CSV_FILE;
    let vertretungsplanData = null;
    
    // Wenn Login-Daten vorhanden sind, versuche automatisierte Sitzung
    if (USERNAME && PASSWORD) {
      console.log('Login-Daten gefunden, versuche automatisierte Sitzung...');
      try {
        const results = await autoLoginAndDownload();
        csvFilePath = results.calendarFile;
        vertretungsplanData = results.vertretungsplan;
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
    const scheduleData = convertCSVToScheduleFormat(csvData, vertretungsplanData);
    
    // Prüfe, ob aktuelle Termine gefunden wurden
    let termineGefunden = false;
    
    for (const day in scheduleData) {
      if (scheduleData[day].subjects.length > 0) {
        const filteredSubjects = scheduleData[day].subjects.filter(
          entry => !entry.includes('-------------------------') && 
                  !entry.includes('VERTRETUNGEN HEUTE')
        );
        
        if (filteredSubjects.length > 0) {
          termineGefunden = true;
          break;
        }
      }
    }
    
    // Wenn keine aktuellen Termine gefunden wurden, füge Hinweis hinzu
    if (!termineGefunden) {
      console.log('Keine aktuellen Termine gefunden!');
      // Füge Hinweis zu jedem Tag hinzu
      for (const day in scheduleData) {
        scheduleData[day].subjects.push('⚠️ *Für die aktuelle Woche sind keine Termine eingetragen.*');
        scheduleData[day].subjects.push('🔍 *Bitte überprüfe das Schulportal für aktuelle Informationen.*');
      }
    }
    
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