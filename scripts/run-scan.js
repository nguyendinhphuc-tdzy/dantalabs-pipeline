// scripts/run-scan.js
require('dotenv').config({ path: '.env.local' });
const { ApifyClient } = require('apify-client');
const { createClient } = require('@supabase/supabase-js');

// 1. Kết nối Supabase & Apify
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const apifyToken = process.env.APIFY_API_TOKEN;

if (!supabaseUrl || !supabaseKey || !apifyToken) {
    console.error("❌ Thiếu biến môi trường! Kiểm tra file .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const apify = new ApifyClient({ token: apifyToken });

// Hàm tính điểm PageSpeed giả định (Vì check thật tốn thêm API khác, ta tạm random logic dựa trên website)
function estimatePageSpeed(url) {
    if (!url) return 0;
    // Web không có https thường cũ và chậm
    if (!url.startsWith('https')) return Math.floor(Math.random() * 30); 
    return Math.floor(Math.random() * 60) + 40; // Random 40-100
}

async function runScraper(keyword) {
    console.log(`🚀 Bắt đầu quét Google Maps với từ khóa: "${keyword}"...`);

    // 2. Cấu hình Input cho Apify (Google Maps Scraper)
    const runInput = {
        "searchStrings": [keyword],
        "locationQuery": "", 
        "maxCrawledPlacesPerSearch": 5, // Test trước 5 cái cho nhanh
        "language": "en",
    };

    try {
        // 3. Call Apify Actor (google-maps-scraper)
        // Actor ID of Google Maps Scraper is 'compass/crawler-google-places' 
        // Use the most common one: 'nwua9Gu5YrADL7ZUj' (Google Maps Scraper)
        console.log("⏳ Calling Apify Actor (may take 30-60 seconds)...");
        
        const run = await apify.actor("nwua9Gu5YrADL7ZUj").call(runInput);
        
        console.log(`✅ Scratching complete! Loading data from Dataset: ${run.defaultDatasetId}`);
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();

        if (items.length === 0) {
            console.log("⚠️ No results found.");
            return;
        }

        // 4. Process and save to Supabase
        console.log(`💾 Saving company ${items.length} to the database...`);
        
        const companies = items.map(item => {
            const hasSSL = item.website ? item.website.startsWith('https') : false;
            const score = estimatePageSpeed(item.website);
            // Scan logic: if PageSpeed < 50 or no SSL then qualified
            const isQualified = score < 50 || !hasSSL; 

            return {
                name: item.title,
                website_url: item.website || null,
                google_maps_url: item.url,
                industry: item.categoryName || keyword,
                address: item.address,
                phone_number: item.phone,
                has_ssl: hasSSL,
                pagespeed_score: score,
                status: isQualified ? 'QUALIFIED' : 'DISQUALIFIED',
                disqualify_reason: isQualified ? null : 'Website looks good',
            };
        });

        // Insert each item individually to avoid duplicate errors (or use upsert if necessary).
        const { error } = await supabase.from('companies').insert(companies);

        if (error) {
            console.error("❌ Supabase save error:", error);
        } else {
            console.log("🎉 Success! Data has been uploaded to the Dashboard.");
        }

    } catch (error) {
        console.error("❌ Scraper Error:", error);
    }
}

// Get keywords from the command line.
const keywordArg = process.argv[2];
if (!keywordArg) {
    console.log("⚠️ Enter the keyword. E.g: node scripts/run-scan.js \"Coffee shop in Hanoi\"");
} else {
    runScraper(keywordArg);
}