const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;
const FIREBASE_PROJECT_ID = 'my-life-os-b0878'; 
const LOCAL_DB_PATH = path.join(__dirname, 'database.json');

// Твой мастер-пароль для входа в систему (можешь изменить на свой)
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'admin';

// Инициализация локального файла со всеми необходимыми коллекциями
if (!fs.existsSync(LOCAL_DB_PATH)) {
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify({ tasks: [], habits: [], logs: [], expenses: [] }, null, 2));
}

function readLocalDB() {
  return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
}

function writeLocalDB(data) {
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {
  // Настройка заголовков CORS для стабильного общения с фронтендом
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ==========================================
  // АВТОРИЗАЦИЯ: POST /login
  // ==========================================
  if (req.url === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        if (payload.password === MASTER_PASSWORD) {
          res.end(JSON.stringify({ success: true }));
        } else {
          res.end(JSON.stringify({ success: false, error: 'Incorrect password' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ==========================================
  // СТАТУС СЕРВЕРА
  // ==========================================
  if ((req.url === '/' || req.url.startsWith('/?')) && req.method === 'GET') {
    // __dirname — это папка "src". Выходим из неё на один уровень вверх (..) 
    // и заходим в папку "public", где лежит твой index.html
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Ошибка загрузки фронтенда. Сервер искал файл тут: ${indexPath}`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  // ==========================================
  // ЗАДАЧИ: GET /tasks
  // ==========================================
  if (req.url === '/tasks' && req.method === 'GET') {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/tasks`;
    fetch(url)
      .then(cloudRes => { if (!cloudRes.ok) throw new Error(); return cloudRes.json(); })
      .then(data => {
        const tasks = (data.documents || []).map(doc => {
          const f = doc.fields;
          return {
            id: doc.name.split('/').pop(),
            text: f.text ? f.text.stringValue : '',
            targetPeriod: f.targetPeriod ? f.targetPeriod.stringValue : 'today',
            targetDate: f.targetDate ? f.targetDate.stringValue : '',
            isMain: f.isMain ? f.isMain.booleanValue : false,
            parentId: f.parentId ? f.parentId.stringValue : null,
            priority: f.priority ? f.priority.stringValue : 'medium',
            category: f.category ? f.category.stringValue : 'personal',
            notes: f.notes ? f.notes.stringValue : '',
            done: f.done ? f.done.booleanValue : false
          };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tasks }));
      })
      .catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tasks: readLocalDB().tasks }));
      });
    return;
  }

  // ==========================================
  // ЗАДАЧИ: POST /tasks
  // ==========================================
  if (req.url === '/tasks' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Text is required' }));
          return;
        }

        const timestampId = 'task_' + Date.now();
        const newTask = {
          id: timestampId,
          text: payload.text,
          targetPeriod: payload.targetPeriod || 'today',
          targetDate: payload.targetDate || '',
          isMain: payload.isMain || false,
          parentId: payload.parentId || null,
          priority: payload.priority || 'medium',
          category: payload.category || 'personal',
          notes: payload.notes || '',
          done: false
        };

        const localData = readLocalDB();
        localData.tasks.push(newTask);
        writeLocalDB(localData);

        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/tasks?documentId=${timestampId}`;
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              text: { stringValue: newTask.text },
              targetPeriod: { stringValue: newTask.targetPeriod },
              targetDate: { stringValue: newTask.targetDate },
              isMain: { booleanValue: newTask.isMain },
              parentId: { stringValue: newTask.parentId || '' },
              priority: { stringValue: newTask.priority },
              category: { stringValue: newTask.category },
              notes: { stringValue: newTask.notes },
              done: { booleanValue: newTask.done }
            }
          })
        }).then(() => {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, id: timestampId }));
        }).catch(() => {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, mode: 'offline', id: timestampId }));
        });
      } catch (err) {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  // ==========================================
  // ЗАДАЧИ: PATCH /tasks/:id
  // ==========================================
  if (req.url.startsWith('/tasks/') && req.method === 'PATCH') {
    const taskId = req.url.split('/').pop();
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        
        const localData = readLocalDB();
        const taskIndex = localData.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
          localData.tasks[taskIndex] = { ...localData.tasks[taskIndex], ...updates };
          writeLocalDB(localData);
        }

        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/tasks/${taskId}?updateMask.fieldPaths=done`;
        fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              done: { booleanValue: updates.done }
            }
          })
        }).then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }).catch(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, mode: 'offline' }));
        });
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // ==========================================
  // ПРИВЫЧКИ (HABITS)
  // ==========================================
  if (req.url === '/habits' && req.method === 'GET') {
    fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/habits`)
      .then(r => r.json()).then(d => {
        const habits = (d.documents || []).map(doc => ({ id: doc.name.split('/').pop(), title: doc.fields.title.stringValue }));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, habits }));
      }).catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, habits: readLocalDB().habits })); });
    return;
  }
  if (req.url === '/habits' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      try {
        const { title } = JSON.parse(body); const db = readLocalDB(); db.habits.push({ id: 'h_'+Date.now(), title }); writeLocalDB(db);
        fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/habits`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { title: { stringValue: title } } })
        }).then(() => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); })
          .catch(() => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); });
      } catch(e) { res.writeHead(400); res.end(); }
    }); return;
  }

  // ==========================================
  // ДНЕВНИК (LOGS)
  // ==========================================
  if (req.url === '/logs' && req.method === 'GET') {
    fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/logs`)
      .then(r => r.json()).then(d => {
        const logs = (d.documents || []).map(doc => ({ id: doc.name.split('/').pop(), note: doc.fields.note.stringValue, createdAt: doc.fields.createdAt.stringValue }));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, logs }));
      }).catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, logs: readLocalDB().logs })); });
    return;
  }
  if (req.url === '/logs' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      try {
        const { note } = JSON.parse(body); const ts = new Date().toLocaleString('ru-RU'); const db = readLocalDB(); db.logs.push({ id: 'l_'+Date.now(), note, createdAt: ts }); writeLocalDB(db);
        fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/logs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { note: { stringValue: note }, createdAt: { stringValue: ts } } })
        }).then(() => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); })
          .catch(() => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); });
      } catch(e) { res.writeHead(400); res.end(); }
    }); return;
  }

  // ==========================================
  // ФИНАНСЫ (EXPENSES)
  // ==========================================
  if (req.url === '/expenses' && req.method === 'GET') {
    fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/expenses`)
      .then(r => r.json()).then(d => {
        const expenses = (d.documents || []).map(doc => ({ id: doc.name.split('/').pop(), amount: doc.fields.amount.stringValue, category: doc.fields.category.stringValue, createdAt: doc.fields.createdAt.stringValue }));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, expenses }));
      }).catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, expenses: readLocalDB().expenses })); });
    return;
  }
  if (req.url === '/expenses' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      try {
        const { amount, category } = JSON.parse(body); const ts = new Date().toLocaleString('ru-RU'); const db = readLocalDB(); db.expenses.push({ id: 'e_'+Date.now(), amount, category, createdAt: ts }); writeLocalDB(db);
        fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/expenses`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { amount: { stringValue: String(amount) }, category: { stringValue: category }, createdAt: { stringValue: ts } } })
        }).then(() => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); })
          .catch(() => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); });
      } catch(e) { res.writeHead(400); res.end(); }
    }); return;
  }

  // Если маршрут не найден
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`[server]: Super-Task Engine active on http://localhost:${PORT}`);
});
