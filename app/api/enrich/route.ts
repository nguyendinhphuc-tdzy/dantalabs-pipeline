import { supabase } from "@/lib/supabase/client";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { companyId, companyName } = await request.json();
    console.log(`🕵️‍♂️ Finding Decision Makers for: "${companyName}"...`);

    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;

    if (!apiKey || !cx) {
      return NextResponse.json({ success: false, error: "Missing Google API Key" }, { status: 500 });
    }

    // 1. IMPROVED QUERY: Remove quotes around company name for broader match
    // Add keywords for Vietnam context since we are searching local companies
    const query = `${companyName} (CEO OR Founder OR Director OR "Giám đốc" OR Manager) site:linkedin.com`;
    
    console.log("Querying Google:", query);
    
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;

    const res = await fetch(googleUrl);
    
    if (!res.ok) {
        const errorText = await res.text();
        console.error("Google API Error:", errorText);
        return NextResponse.json({ success: false, error: "Google API Connection Failed" });
    }

    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      console.warn("⚠️ Google returned 0 raw results.");
      return NextResponse.json({ success: false, message: "No results found on Google" });
    }

    console.log(`✅ Google found ${data.items.length} raw results. Processing...`);

    // 2. SMARTER PARSING LOGIC
    const contacts: any[] = [];
    
    for (const item of data.items) {
        const link = item.link || "";
        const title = item.title || "";

        // FILTER: Accept any LinkedIn link EXCEPT Company Pages or Job Posts
        // This allows vn.linkedin.com, www.linkedin.com/in, etc.
        const isLinkedIn = link.includes("linkedin.com");
        const isCompanyPage = link.includes("/company/") || link.includes("/jobs/") || link.includes("/school/");

        if (isLinkedIn && !isCompanyPage) {
            
            // CLEAN TITLE: Remove " | LinkedIn" suffix
            let cleanTitle = title
                .replace(" | LinkedIn", "")
                .replace(" - LinkedIn", "")
                .replace(" | Ho Chi Minh City", "") // Common junk
                .replace(" | Vietnam", "");

            // PARSE NAME & POSITION
            // Format usually: "Name - Position - Company" OR "Name - Position"
            const parts = cleanTitle.split(" - ");
            
            let fullName = parts[0];
            let position = "Decision Maker"; // Default fallback

            if (parts.length >= 2) {
                // Heuristic: If part[1] is NOT the company name, it's likely the position
                // Check similarity strictly
                if (!parts[1].toLowerCase().includes(companyName.toLowerCase())) {
                    position = parts[1];
                } else if (parts.length >= 3) {
                    // "Name - Company - Position" case (rare but happens)
                    position = parts[2];
                }
            } else {
                // If splitting fails, try to guess from the snippet
                const snippet = item.snippet || "";
                if (snippet.includes("CEO")) position = "CEO";
                else if (snippet.includes("Founder")) position = "Founder";
                else if (snippet.includes("Director")) position = "Director";
                else if (snippet.includes("Manager")) position = "Manager";
            }

            // AVOID DUPLICATES
            if (!contacts.find(c => c.full_name === fullName)) {
                contacts.push({
                    company_id: companyId,
                    full_name: fullName.trim(),
                    position: position.trim(),
                    linkedin_url: link,
                    is_primary_decision_maker: true,
                    email: null
                });
            }
        }
        
        // Limit to 3 contacts
        if (contacts.length >= 3) break;
    }

    // FALLBACK: If filtering removed everyone, just take the first result as a raw guess
    // This ensures we rarely return "Empty" if Google actually found something.
    if (contacts.length === 0 && data.items.length > 0) {
         console.log("⚠️ Strict filter returned 0. Using fallback to first result.");
         const fallbackItem = data.items[0];
         if (fallbackItem.link.includes("linkedin.com")) {
             contacts.push({
                company_id: companyId,
                full_name: fallbackItem.title.split(" - ")[0] || "Unknown Profile",
                position: "Potential Contact",
                linkedin_url: fallbackItem.link,
                is_primary_decision_maker: false,
                email: null
             });
         }
    }

    if (contacts.length === 0) {
         return NextResponse.json({ success: false, message: "Found results but none were valid profiles" });
    }

    // 3. Save to Supabase
    const { error } = await supabase
      .from('contacts')
      .insert(contacts);

    if (error) {
        console.error("Supabase Insert Error:", error);
        throw error;
    }

    console.log(`💾 Saved ${contacts.length} contacts to Database.`);

    return NextResponse.json({ success: true, count: contacts.length });

  } catch (error: any) {
    console.error("❌ Enrich Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}