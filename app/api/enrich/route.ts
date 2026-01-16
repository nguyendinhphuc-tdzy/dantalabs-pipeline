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
      return NextResponse.json({ success: false, error: "Missing API Keys (Google Search or AI)" }, { status: 500 });
    }

    // 1. Google Search Query (Tìm LinkedIn Profile)
    // Query rộng hơn một chút để lấy context cho AI
    const query = `site:linkedin.com/in/ "${companyName}" (CEO OR Founder OR Director OR "Giám đốc" OR Head OR Manager)`;
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;

    const res = await fetch(googleUrl);
    
    if (!res.ok) {
        const errorText = await res.text();
        console.error("Google Search API Error:", errorText);
        return NextResponse.json({ success: false, error: "Google Search API Failed" });
    }

    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      return NextResponse.json({ success: false, message: "No results found on Google" });
    }

    // 2. Chuẩn bị dữ liệu thô để gửi cho Gemini
    // Chúng ta gửi 5 kết quả đầu tiên (Title + Snippet) để AI đọc hiểu
    const searchContext = data.items.slice(0, 5).map((item: any) => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link
    }));

    // 3. Dùng Gemini để trích xuất thông tin chi tiết (Intelligence Extraction)
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      You are an expert Sales Data Researcher.
      Analyze these Google Search results for LinkedIn profiles related to the company "${companyName}".
      
      SEARCH RESULTS:
      ${JSON.stringify(searchContext)}

      TASK:
      Extract up to 3 most relevant Decision Makers (Focus on: CEO, Founder, CTO, Directors, Heads).
      For each person, infer the following details based on the title and snippet text:

      1. Full Name: Clean name, remove titles like 'MBA', 'PhD', '| LinkedIn'.
      2. Exact Position: The job title at ${companyName}.
      3. Seniority: Choose one of ["C-Level", "VP", "Director", "Manager", "Individual Contributor"].
      4. Language: Infer likely primary language based on Name and Location context (e.g., "Vietnamese", "English", "Japanese").
      5. Years in Company: Look for duration in the snippet (e.g., "5 years", "2018 - Present"). If not found, return "Unknown".
      6. Socials: LinkedIn is provided. If the snippet mentions Twitter/Facebook, extract it, otherwise null.

      OUTPUT JSON FORMAT ONLY (Array of objects):
      [
        {
          "full_name": "Nguyen Van A",
          "position": "CEO",
          "seniority": "C-Level",
          "language": "Vietnamese",
          "years_in_company": "5 years",
          "linkedin_url": "https://linkedin.com/in/...",
          "facebook_url": null,
          "twitter_url": null
        }
      ]
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Clean up markdown code blocks if AI adds them
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    let parsedContacts;
    try {
        parsedContacts = JSON.parse(cleanJson);
    } catch (e) {
        console.error("AI JSON Parse Error:", e);
        return NextResponse.json({ success: false, error: "Failed to parse AI response" });
    }

    if (!Array.isArray(parsedContacts) || parsedContacts.length === 0) {
        return NextResponse.json({ success: false, message: "AI found no valid contacts" });
    }

    // 4. Lưu vào Supabase
    const contactsToSave = parsedContacts.map((c: any) => ({
        company_id: companyId,
        full_name: c.full_name,
        position: c.position,
        linkedin_url: c.linkedin_url,
        // Các trường mới
        seniority: c.seniority,
        language: c.language,
        years_in_company: c.years_in_company,
        facebook_url: c.facebook_url,
        twitter_url: c.twitter_url,
        
        // Xác định primary decision maker dựa trên cấp bậc
        is_primary_decision_maker: ['C-Level', 'VP', 'Director', 'Founder'].includes(c.seniority),
        email: null // Email thường không có trên Google Search công khai
    }));

    const { error } = await supabase.from('contacts').insert(contactsToSave);

    if (error) {
        console.error("Supabase Insert Error:", error);
        throw error;
    }

    console.log(`✅ Saved ${contactsToSave.length} enriched profiles for ${companyName}.`);

    return NextResponse.json({ success: true, count: contactsToSave.length, data: contactsToSave });

  } catch (error: any) {
    console.error("❌ Enrich Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}