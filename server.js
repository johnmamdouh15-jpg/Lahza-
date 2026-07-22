// ==============================================================
// لحظة — Backend (Railway/Render) — Google Gemini API
// ==============================================================

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors()); 
app.use(express.json({ limit: "10mb" }));

// 1. تعديل البورت لضمان القبول على Railway
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 2. تغيير الموديل الافتراضي لـ 1.5-flash لأنه أكثر استقراراً في الحصة المجانية
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; 

const VALID_KEYS = (process.env.AGENT_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);

if (!GEMINI_API_KEY) {
  console.error("⚠️  GEMINI_API_KEY is missing in environment variables!");
}

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
  if (VALID_KEYS.length === 0) return next();
  const key = req.header("X-Api-Key");
  if (!key || !VALID_KEYS.includes(key)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.get("/api/tags", checkAuth, (req, res) => {
  res.json({ models: [{ name: "lahza" }] });
});

app.post("/api/chat", checkAuth, async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const contents = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content || "" }]
      }));

    if (contents.length === 0) {
      return res.status(400).json({ error: "no messages" });
    }

    // استخدام v1beta أو v1 حسب الموديل
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.7, topP: 0.9 }
        })
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Gemini API Error:", data);
      // إرسال رسالة مفهومة للمستخدم عند تخطي الكوتا
      if (geminiRes.status === 429) {
          return res.status(429).json({ error: "الخدمة مشغولة حالياً (تجاوزت حد الاستخدام)، جرب كمان شوية." });
      }
      return res.status(502).json({ error: "upstream_error", detail: data.error?.message });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "(مفيش رد من الموديل)";

    res.json({ message: { role: "assistant", content: text } });
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: "server_error", detail: err.message });
  }
});

app.get("/", (req, res) => res.send("لحظة backend شغال ✓"));

// تعديل هام: إضافة '0.0.0.0' لضمان عمل الهيلث تشيك في ريلوي
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
