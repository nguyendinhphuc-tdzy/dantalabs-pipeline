import { supabase } from "@/lib/supabase/client";
import { NextResponse } from "next/server";
import { ApifyClient } from "apify-client";

// Initialize Apify Client with the token from .env.local
const apifyClient = new ApifyClient({
  token: process.env.APIFY_API_TOKEN,
});

// HÀM PHỤ: Kiểm tra công nghệ Website (WordPress? CRM?)
async function detectTechStack(url: string | null) {
    if (!url) return { isWordpress: false, crm: null };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // Timeout 5s để không làm chậm scan

        const res = await fetch(url, { 
            method: 'GET',
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DantaBot/1.0)' }
        });
        clearTimeout(timeoutId);

        if (!res.ok) return { isWordpress: false, crm: null };

        const html = await res.text();
        const lowerHtml = html.toLowerCase();

        // 1. Check WordPress
        // Dấu hiệu: wp-content, wp-includes, generator wordpress
        const isWordpress = lowerHtml.includes('wp-content') || lowerHtml.includes('wp-includes');

        // 2. Check CRM signatures in HTML/Scripts
        let crm = null;
        if (lowerHtml.includes('js.hs-scripts.com') || lowerHtml.includes('hubspot')) {
            crm = "HubSpot";
        } else if (lowerHtml.includes('salesforce') || lowerHtml.includes('pardot')) {
            crm = "Salesforce";
        } else if (lowerHtml.includes('zoho')) {
            crm = "Zoho CRM";
        } else if (lowerHtml.includes('bitrix24')) {
            crm = "Bitrix24";
        }

        return { isWordpress, crm };

    } catch (error) {
        // Lỗi kết nối hoặc timeout thì bỏ qua, coi như không tìm thấy
        return { isWordpress: false, crm: null };
    }
}

export async function POST(request: Request) {
  try {
    const { keyword } = await request.json();
    console.log(`🔍 Starting Real Google Maps Scan for keyword: "${keyword}"...`);

    // Validation: Check if Apify Token exists
    if (!process.env.APIFY_API_TOKEN) {
      console.error("❌ APIFY_API_TOKEN is missing in .env.local");
      return NextResponse.json(
        { success: false, error: "Server configuration error: Missing Apify Token" },
        { status: 500 }
      );
    }

    // 1. Configure Apify Input (Google Maps Scraper)
    const runInput = {
      "searchStringsArray": [keyword], 
      "maxCrawledPlacesPerSearch": 5, // Limit to 5 results for demo speed
      "language": "en",
      "maxImages": 0, 
    };

    // 2. Call Apify Actor (compass/crawler-google-places)
    console.log("⏳ Calling Apify Actor (compass/crawler-google-places)...");
    const run = await apifyClient.actor("compass/crawler-google-places").call(runInput);

    console.log(`✅ Apify run finished! Dataset ID: ${run.defaultDatasetId}`);

    // 3. Fetch results from Dataset
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

    if (!items || items.length === 0) {
      console.warn("⚠️ No results found on Google Maps.");
      return NextResponse.json({ success: false, message: "No results found" });
    }

    // 4. Process data and map to Database Schema
    // Dùng Promise.all để quét Tech Stack song song cho nhanh
    const processedCompanies = await Promise.all(items.map(async (item: any) => {
      const websiteUrl = item.website || null;
      const hasSSL = websiteUrl ? websiteUrl.startsWith('https') : false;
      
      // Simulate PageSpeed Score logic
      let estimatedScore = Math.floor(Math.random() * 40) + 60; // Default: 60-100 (Good)
      if (!hasSSL || !websiteUrl) estimatedScore = Math.floor(Math.random() * 40); // 0-40 (Bad)

      // --- NEW: DETECT TECH STACK ---
      const techInfo = await detectTechStack(websiteUrl);

      // Qualification Logic (Example: Low score OR No SSL OR Using WordPress might be a target)
      const isQualified = estimatedScore < 50 || !hasSSL;

      return {
        name: item.title,
        website_url: websiteUrl,
        google_maps_url: item.url,
        industry: item.categoryName || keyword,
        
        // New Fields Mapped
        address: item.address, 
        has_ssl: hasSSL,
        pagespeed_score: estimatedScore,
        
        // Tech Stack Data
        is_wordpress: techInfo.isWordpress,
        crm_system: techInfo.crm,
        
        // Placeholder data for enrichment later
        company_type: "Private", 
        employee_count: "Unknown",
        revenue_range: "Unknown",

        status: isQualified ? 'QUALIFIED' : 'DISQUALIFIED',
        disqualify_reason: isQualified ? null : 'Website looks good / High Performance',
      };
    }));

    // 5. Bulk Insert into Supabase
    const { data, error } = await supabase
      .from('companies')
      .insert(processedCompanies)
      .select();

    if (error) {
      console.error("❌ Supabase Insert Error:", error);
      throw error;
    }

    console.log(`💾 Successfully saved ${processedCompanies.length} companies to Database.`);

    return NextResponse.json({ success: true, data });

  } catch (error: any) {
    console.error("❌ API Error:", error);
    return NextResponse.json({ success: false, error: error.message || "Scan failed" }, { status: 500 });
  }
}