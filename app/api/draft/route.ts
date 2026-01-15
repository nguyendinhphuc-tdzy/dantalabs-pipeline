import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. CẤU HÌNH HỒ SƠ DANTA LABS (Dựa trên Slide Onboarding)
const DANTA_PROFILE = `
  - COMPANY: Danta Labs
  - MISSION: Build, Scale & Deploy Enterprise AI Agents. We build the infrastructure for the next generation of autonomous software.
  - KEY PRODUCTS:
    1. "Maestro": An Agentic Cloud Platform (Infrastructure) for orchestration, evaluation, and execution of AI agents. Solves the problem of scaling agents across business functions.
    2. "Quack": An AI Lead Prospecting Agent. It qualifies leads on autopilot, interacts with clients, and updates CRM. Ideal for Sales & Marketing teams.
    3. "Colectia": An Automated Debt Collection Agent. Reviews accounts payable, contacts clients via WhatsApp/phone, and negotiates payment. Ideal for Finance/Banking/Retail.
  - VALUE PROPOSITION: We lower the barrier to enterprise adoption. We fix the "Scaling Problem" (poor integration, no observability, data governance) that causes 95% of GenAI pilots to fail.
  - FOUNDERS: Samuel Villaneda (CEO) & Santiago Canchila (CTO).
`;

export async function POST(request: Request) {
  try {
    const { contactName, position, companyName, website, industry, hasSSL, pageSpeed } = await request.json();

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "Missing Google AI Key" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Sử dụng model mới nhất (hoặc 1.5 flash nếu 2.5 chưa public qua SDK này)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 2. LOGIC "DEEP RESEARCH" & PRODUCT MATCHING
    const prompt = `
      ROLE: You are "Sam", CEO at Danta Labs.
      
      YOUR PROFILE:
      ${DANTA_PROFILE}

      TARGET PROSPECT:
      - Name: ${contactName}
      - Position: ${position}
      - Company: ${companyName}
      - Industry: ${industry || "Unknown"}
      - Website: ${website}
      
      TASK: 
      Perform a "Deep Research" simulation to identify the prospect's likely operational bottlenecks based on their Industry and Position. Then write a high-level B2B Cold Email.

      STRATEGY (Mental Chain of Thought):
      1. **Analyze Industry:** - If Finance/Banking/Retail -> Pain point is likely "Debt Collection" or "Payment Ops". -> Pitch "Colectia".
         - If Agency/SaaS/Consulting -> Pain point is likely "Lead Qualification" or "Pipeline efficiency". -> Pitch "Quack".
         - If Enterprise/Tech -> Pain point is "Scaling AI" or "Data Governance". -> Pitch "Maestro".
         - If others -> Focus on "Automating Internal Processes" to reduce costs (Optimization).
      2. **Analyze Position:**
         - CEO/Founder -> Cares about Growth, Cost Reduction, and Scalability.
         - CTO/Tech Lead -> Cares about Infrastructure, Security, and Integration (Maestro is key here).
         - Sales/Marketing VP -> Cares about Conversion Rates and Leads (Quack).
      3. **Value Drop:** Do NOT mention SSL or PageSpeed unless it's critical. Focus on *Business Value* (Revenue, Efficiency, Automation).

      EMAIL GUIDELINES:
      - Language: English (Professional, US Business Standard).
      - Tone: Insightful, Peer-to-Peer, Direct (No fluff).
      - Opening: "I've been following [Company Name] and noticed..." (Cite a relevant observation about their scale/industry).
      - Body: "Most [Industry] leaders I speak with struggle with [Specific Pain Point]. At Danta Labs, we solve this by [Specific Solution/Agent]."
      - CTA: Low friction (e.g., "Worth a brief chat to see how this fits your roadmap?").
      - Signature: Sam, Danta Labs.

      OUTPUT FORMAT (JSON ONLY):    
      {
        "subject": "Catchy subject line (Max 6 words, focus on value/curiosity)",
        "body": "The email content with proper spacing"
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Clean JSON
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const jsonResponse = JSON.parse(cleanText);

    return NextResponse.json({ success: true, data: jsonResponse });

  } catch (error: any) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}