import * as express from 'express';
import * as path from 'path';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  // TODO: wire up to Alice assistant logic
  res.json({ reply: `Echo: ${message}` });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
