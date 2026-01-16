import { supabase } from "@/lib/supabase/client";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: Request) {
  try {
    const { companyId, companyName } = await request.json();
    console.log(`🕵️‍♂️ AI Enriching Decision Makers for: "${companyName}"...`);

    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;
    const geminiKey = process.env.GOOGLE_AI_API_KEY;

    if (!apiKey || !cx || !geminiKey) {
      return NextResponse.json({ success: false, error: "Missing API Keys" }, { status: 500 });
    }

    // 1. Google Search Query (Tìm kiếm rộng hơn để lấy cả Twitter/Facebook nếu có)
    // Cấu trúc: "Tên công ty" + (CEO/Founder) + site:linkedin.com OR site:twitter.com ...
    const query = `"${companyName}" (CEO OR Founder OR Director OR "Giám đốc") (site:linkedin.com OR site:twitter.com OR site:facebook.com)`;
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;

    const res = await fetch(googleUrl);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      return NextResponse.json({ success: false, message: "No results found on Google" });
    }

    // 2. Chuẩn bị dữ liệu cho AI đọc
    const searchContext = data.items.slice(0, 8).map((item: any) => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link
    }));

    // 3. Dùng Gemini để trích xuất thông tin (Intelligence Extraction)
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      You are a Sales Intelligence Agent.
      Analyze these Google Search results for the company "${companyName}".
      
      SEARCH RESULTS:
      ${JSON.stringify(searchContext)}

      TASK:
      Identify up to 3 key decision makers (CEO, Founder, CTO, Director).
      For each person, extract or infer the following details strictly from the text provided:
      
      1. full_name: Clean name (remove titles like PhD, MBA).
      2. position: Specific role (e.g., CEO, Marketing Director).
      3. social_profiles:
         - linkedin: URL (if found)
         - twitter: URL (if found)
         - facebook: URL (if found)
      4. language: Detect likely language based on name and snippet text (e.g., "Vietnamese", "English").
      5. years_in_company: Look for phrases like "5 years at...", "since 2018". If not found, return "Unknown".
      6. seniority: Classify into one of ["C-Level", "VP", "Director", "Manager", "Individual Contributor"].

      OUTPUT JSON FORMAT ONLY (Array):
      [
        {
          "full_name": "...",
          "position": "...",
          "linkedin_url": "...",
          "twitter_url": "...",   // null if not found
          "facebook_url": "...",  // null if not found
          "language": "...",
          "years_in_company": "...",
          "seniority": "..."
        }
      ]
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let parsedContacts;
    try {
        parsedContacts = JSON.parse(cleanJson);
    } catch (e) {
        console.error("JSON Parse Error:", e);
        return NextResponse.json({ success: false, error: "AI response parsing failed" });
    }

    if (!Array.isArray(parsedContacts) || parsedContacts.length === 0) {
        return NextResponse.json({ success: false, message: "AI found no valid contacts" });
    }

    // 4. Lưu vào Supabase
    const contactsToSave = parsedContacts.map((c: any) => ({
        company_id: companyId,
        full_name: c.full_name,
        position: c.position,
        linkedin_url: c.linkedin_url || null,
        twitter_url: c.twitter_url || null,
        facebook_url: c.facebook_url || null,
        language: c.language || "English",
        years_in_company: c.years_in_company || "Unknown",
        seniority: c.seniority || "Director",
        
        is_primary_decision_maker: ['C-Level', 'VP', 'Director'].includes(c.seniority),
        email: null
    }));

    // Insert (hoặc Upsert nếu cần)
    const { error } = await supabase.from('contacts').insert(contactsToSave);

    if (error) {
        console.error("Supabase Error:", error);
        throw error;
    }

    console.log(`✅ Saved ${contactsToSave.length} enriched profiles.`);
    return NextResponse.json({ success: true, count: contactsToSave.length });

  } catch (error: any) {
    console.error("❌ Enrich Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}