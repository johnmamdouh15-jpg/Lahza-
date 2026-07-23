// لحظة — Backend (Render) — بيستخدم Google Gemini بدل Ollama
// ==============================================================

const express = require("express");
const cors = require("cors");
// Node 18+ بيدعم fetch جاهز، بس بعض بيئات الاستضافة بتشغل نسخة أقدم —
// السطر ده بيضمن إن fetch يشتغل في الحالتين من غير ما نعرف نسخة Node بالظبط.
const fetchFn = globalThis.fetch || ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const app = express();
app.use(cors()); // لو عايز تقفلها على دومين فيرسل بس، بدّل السطر ده بـ cors({ origin: "https://your-frontend.vercel.app" })
app.use(express.json({ limit: "15mb" }));

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
// AGENT_KEYS: مفتاح أو أكتر مفصولين بفاصلة، كل عميل تديله مفتاح مختلف لو حبيت
const VALID_KEYS = (process.env.AGENT_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);

if (!GEMINI_API_KEY) {
  console.error("⚠️  GEMINI_API_KEY مش متظبط في الـ Environment Variables على Render.");
}
if (VALID_KEYS.length === 0) {
  console.warn("⚠️  AGENT_KEYS مش متظبط — أي حد هيقدر يستخدم الـ API من غير مفتاح.");
}

// النظام/الشخصية بتاعة لحظة — نفس اللي كان في Modelfile-lahza، عدّلتها بس عشان
// توليد الصور اتشال من المنتج دلوقتي.
const SYSTEM_PROMPT = `أنت "لحظة" — الوكيل الذكي الوحيد من إنتاج Lahza. مش مقسّم لأوضاع منفصلة، انت agent واحد بيفهم من كلام المستخدم هو عايز إيه ويرد بالشكل المناسب من غير ما تسأله يختار وضع.

- لو طلب إيميل: اكتبه جاهز للنسخ مباشرة (بدون سلام أو شرح زيادة إلا لو طلب).
- لو طلب كود (شرح، تعديل، تصحيح، أو كتابة كود جديد بأي لغة): تعامل معاه كمبرمج خبير. حط الكود دايمًا جوه code block.
- لو طلب تحليل ملف نصي مرفق، اقرأ المحتوى اللي هيوصلك وجاوب بناءً عليه مباشرة.
- لو الطلب مختلط (مثلاً كود ثم إيميل بيه)، نفّذ الاتنين في نفس الرد.

قواعد عامة:
1. رد بالعربي إلا لو المستخدم كتب بلغة تانية.
2. لو مش متأكد من حاجة، قول كده صراحة بدل ما تخمّن.
3. خليك مختصر ومباشر إلا لو الموضوع محتاج تفصيل.
4. متقولش اسم أي موديل أو أداة خارجية بتشتغل عليها من ورا الكواليس — انت "لحظة" بس.`;

function checkAuth(req, res, next) {
  if (VALID_KEYS.length === 0) return next(); // مفيش مفاتيح متظبطة = مفتوح (مش موصى بيه في الإنتاج)
  const key = req.header("X-Api-Key");
  if (!key || !VALID_KEYS.includes(key)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// بيحاكي شكل رد /api/tags بتاع Ollama عشان الفرونت الحالي (checkStatus) يشتغل من غير تعديل
app.get("/api/tags", checkAuth, (req, res) => {
  res.json({ models: [{ name: "lahza" }] });
});

// بيحاكي شكل /api/chat بتاع Ollama: بياخد { model, messages, stream } ويرجّع { message: { content } }
app.post("/api/chat", checkAuth, async (req, res) => {
  try {
    const { messages = [] } = req.body;

    // حوّل تاريخ الشات من شكل Ollama (role: user/assistant) لشكل Gemini (role: user/model)
    // ولو الرسالة فيها صورة مرفقة (images + imageMime)، ضيفها كـ inline_data part.
    const contents = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => {
        const parts = [{ text: m.content || "" }];
        if (m.role === "user" && Array.isArray(m.images) && m.images.length) {
          parts.push({
            inline_data: {
              mime_type: m.imageMime || "image/jpeg",
              data: m.images[0]
            }
          });
        }
        return { role: m.role === "assistant" ? "model" : "user", parts };
      });

    if (contents.length === 0) {
      return res.status(400).json({ error: "no messages" });
    }

    const geminiRes = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.5, topP: 0.9 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini error:", geminiRes.status, errText);
      return res.status(502).json({ error: "upstream_error", detail: errText });
    }

    const data = await geminiRes.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") ||
      "(مفيش رد من الموديل)";

    res.json({ message: { role: "assistant", content: text } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", detail: err.message });
  }
});

app.get("/", (req, res) => res.send("لحظة backend شغال ✓"));

app.listen(PORT, () => console.log(`لحظة backend شغال على بورت ${PORT}`));

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));
