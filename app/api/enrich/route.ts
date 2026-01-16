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

    // 1. QUERY MỚI: Tìm rộng hơn (LinkedIn OR Twitter OR Facebook)
    // Loại bỏ bớt các từ khóa rác như "jobs", "careers" để tránh trang tuyển dụng
    const query = `"${companyName}" (CEO OR Founder OR Director OR "Giám đốc" OR "Chủ tịch") (site:linkedin.com OR site:twitter.com OR site:facebook.com) -intitle:jobs -intitle:careers`;
    
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;

    const res = await fetch(googleUrl);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      return NextResponse.json({ success: false, message: "No results found on Google" });
    }

    // 2. Chuẩn bị dữ liệu cho AI (Lấy nhiều kết quả hơn: 8 item)
    const searchContext = data.items.slice(0, 8).map((item: any) => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link
    }));

    // 3. Dùng Gemini để trích xuất (Intelligence Extraction)
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      You are a Sales Intelligence Agent.
      Analyze these Google Search results for the company "${companyName}".
      
      SEARCH RESULTS:
      ${JSON.stringify(searchContext)}

      TASK:
      Identify 1-5 key decision makers (CEO, Founder, CTO, Director).
      For each person, extract or infer the following details strictly from the text provided:
      
      1. full_name: Clean name (remove titles like PhD, MBA, "Profile").
      2. position: Specific role (e.g., CEO, Marketing Director).
      3. social_profiles:
         - linkedin: URL (if found in link)
         - twitter: URL (if found in link)
         - facebook: URL (if found in link)
      4. language: Detect likely language based on name and snippet text (e.g., "Vietnamese", "English").
      5. years_in_company: Look for phrases like "5 years at...", "since 2018". If not found, return "Unknown".
      6. seniority: Classify into one of ["C-Level", "VP", "Director", "Manager", "Individual Contributor"].

      IMPORTANT: If you find a person but some fields are missing, make a reasonable guess or set to null/Unknown. Do NOT return empty if you see a name.

      OUTPUT JSON FORMAT ONLY (Array):
      [
        {
          "full_name": "...",
          "position": "...",
          "linkedin_url": "...",
          "twitter_url": "...",   
          "facebook_url": "...",  
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
        // Fallback: Trả về lỗi để client biết
        return NextResponse.json({ success: false, error: "AI response parsing failed" });
    }

    if (!Array.isArray(parsedContacts) || parsedContacts.length === 0) {
        // Fallback mạnh hơn: Nếu AI không tìm thấy ai, thử lấy kết quả đầu tiên của Google gán làm Contact tạm
        if (data.items.length > 0) {
            console.log("⚠️ AI failed to strict parse. Using raw fallback.");
            const fallback = data.items[0];
            parsedContacts = [{
                full_name: fallback.title.split(" - ")[0] || "Unknown Contact",
                position: "Potential Contact",
                linkedin_url: fallback.link,
                seniority: "Unknown",
                language: "Vietnamese",
                years_in_company: "Unknown"
            }];
        } else {
             return NextResponse.json({ success: false, message: "AI found no valid contacts" });
        }
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