const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;
const FIREBASE_PROJECT_ID = 'my-life-os-b0878'; 
const LOCAL_DB_PATH = path.join(__dirname, 'database.json');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Статус
  if (req.url === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, database: 'Life OS Super-Task Engine' }));
    return;
  }

  // 2. ЗАДАЧИ: GET /tasks (Загрузка расширенных задач)
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
        // Офлайн режим
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tasks: readLocalDB().tasks }));
      });
    return;
  }

  // 3. ЗАДАЧИ: POST /tasks (Создание задачи со всеми новыми свойствами)
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

        // Пишем локально
        const localData = readLocalDB();
        localData.tasks.push(newTask);
        writeLocalDB(localData);

        // Пишем в Firebase Firestore
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

  // 4. ЗАДАЧИ: PATCH /tasks (Обновление статуса "выполнено" или изменение полей)
  if (req.url.startsWith('/tasks/') && req.method === 'PATCH') {
    const taskId = req.url.split('/').pop();
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        
        // Обновляем локально
        const localData = readLocalDB();
        const taskIndex = localData.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
          localData.tasks[taskIndex] = { ...localData.tasks[taskIndex], ...updates };
          writeLocalDB(localData);
        }

        // Обновляем в Firebase (черех маску обновления fields)
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

  // --- ОСТАЛЬНЫЕ СТАРЫЕ МОДУЛИ БЕЗ ИЗМЕНЕНИЙ (Привычки, Дневник, Финансы) ---
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
      const { title } = JSON.parse(body); const db = readLocalDB(); db.habits.push({ id: 'h_'+Date.now(), title }); writeLocalDB(db);
      fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/habits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { title: { stringValue: title } } })
      }).then(() => { res.writeHead(201); res.end(JSON.stringify({ success: true })); }).catch(() => { res.writeHead(201); res.end(JSON.stringify({ success: true })); });
    }); return;
  }
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
      const { note } = JSON.parse(body); const ts = new Date().toLocaleString('ru-RU'); const db = readLocalDB(); db.logs.push({ id: 'l_'+Date.now(), note, createdAt: ts }); writeLocalDB(db);
      fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/logs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { note: { stringValue: note }, createdAt: { stringValue: ts } } })
      }).then(() => { res.writeHead(201); res.end(JSON.stringify({ success: true })); }).catch(() => { res.writeHead(201); res.end(JSON.stringify({ success: true })); });
    }); return;
  }
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
      const { amount, category } = JSON.parse(body); const ts = new Date().toLocaleString('ru-RU'); const db = readLocalDB(); db.expenses.push({ id: 'e_'+Date.now(), amount, category, createdAt: ts }); writeLocalDB(db);
      fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/expenses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { amount: { stringValue: String(amount) }, category: { stringValue: category }, createdAt: { stringValue: ts } } })
      }).then(() => { res.writeHead(201); res.end(JSON.stringify({ success: true })); }).catch(() => { res.writeHead(201); res.end(JSON.stringify({ success: true })); });
    }); return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false }));
});

server.listen(PORT, () => {
  console.log(`[server]: Super-Task Engine active on http://localhost:${PORT}`);
});