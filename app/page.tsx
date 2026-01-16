import { supabase } from "@/lib/supabase/client";
import { StatsOverview } from "@/components/features/pipeline/stats-overview";
import { CompanyTable } from "@/components/features/pipeline/company-table";
import { Company } from "@/types/database";
import { ScanDialog } from "@/components/features/pipeline/scan-dialog";
// Import Component Biểu đồ
import { PipelineAnalytics } from "@/components/features/pipeline/pipeline-analytics";
// Import Tabs UI
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  console.log("🚀 Dashboard: Attempting to fetch data...");

  // 1. Gọi dữ liệu Companies (Công ty)
  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('*')
    .order('created_at', { ascending: false });

  // 2. Gọi dữ liệu Contacts (Người liên hệ)
  // Dữ liệu này dùng để tính xem đã gửi tin nhắn cho bao nhiêu người (Outreach)
  const { data: contacts, error: contactError } = await supabase
    .from('contacts')
    .select('*');

  // Kiểm tra lỗi
  if (companyError || contactError) {
    console.error("❌ Data Error:", companyError || contactError);
    return (
        <div className="p-8 text-red-500">
            Error loading data. Check console for details.
            <br />
            {companyError?.message || contactError?.message}
        </div>
    );
  }

  // Ép kiểu dữ liệu
  const typedCompanies = (companies || []) as Company[];
  const typedContacts = (contacts || []);

  // --- LOGIC PHÂN LOẠI THEO TỪ KHÓA (CAMPAIGNS) ---
  // Lấy danh sách các từ khóa duy nhất. Ưu tiên search_keyword, nếu không có thì dùng industry
  const allKeywords = Array.from(new Set(typedCompanies.map(c => c.search_keyword || c.industry || "Uncategorized")));
  
  // Sắp xếp keyword mới nhất lên đầu (dựa vào ngày tạo của công ty mới nhất trong nhóm đó)
  allKeywords.sort((a, b) => {
      const lastDateA = typedCompanies.find(c => (c.search_keyword || c.industry || "Uncategorized") === a)?.created_at || "";
      const lastDateB = typedCompanies.find(c => (c.search_keyword || c.industry || "Uncategorized") === b)?.created_at || "";
      return lastDateB.localeCompare(lastDateA);
  });

  // Mặc định chọn tab đầu tiên (Chiến dịch mới nhất) hoặc "All"
  const defaultTab = allKeywords.length > 0 ? allKeywords[0] : "All";

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Sales Pipeline</h1>
            <p className="text-slate-500">Automated Lead Generation & Qualification System</p>
          </div>
          <ScanDialog />
        </div>

        {/* Phần thống kê số liệu (Cards) - Hiển thị tổng quan toàn bộ */}
        <StatsOverview data={typedCompanies} />

        {/* Biểu đồ Analytics */}
        <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Performance Analytics</h2>
            <PipelineAnalytics companies={typedCompanies} contacts={typedContacts} />
        </div>

        {/* --- KHU VỰC BẢNG DỮ LIỆU ĐÃ PHÂN TABS --- */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
             <h2 className="text-xl font-semibold text-slate-900">Campaigns Results</h2>
          </div>

          {allKeywords.length > 0 ? (
              <Tabs defaultValue={defaultTab} className="w-full">
                {/* Thanh Tabs cuộn ngang nếu có quá nhiều keyword */}
                <div className="overflow-x-auto pb-2">
                    <TabsList className="bg-white border h-auto p-1 inline-flex w-max min-w-full justify-start">
                        {/* Tab Tổng hợp */}
                        <TabsTrigger value="All" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white px-4 py-2 font-medium">
                            All Campaigns
                        </TabsTrigger>
                        
                        {/* Các Tab Keyword */}
                        {allKeywords.map((keyword) => (
                            <TabsTrigger 
                                key={keyword} 
                                value={keyword}
                                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white px-4 py-2 capitalize font-medium"
                            >
                                {keyword}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                {/* Nội dung Tab "All" */}
                <TabsContent value="All" className="mt-4">
                    <CompanyTable data={typedCompanies} />
                </TabsContent>

                {/* Nội dung từng Tab Keyword */}
                {allKeywords.map((keyword) => (
                    <TabsContent key={keyword} value={keyword} className="mt-4">
                        <CompanyTable 
                            // Lọc danh sách công ty theo keyword tương ứng
                            data={typedCompanies.filter(c => (c.search_keyword || c.industry || "Uncategorized") === keyword)} 
                        />
                    </TabsContent>
                ))}
              </Tabs>
          ) : (
              // Nếu chưa có dữ liệu thì hiện bảng trống
              <CompanyTable data={typedCompanies} />
          )}
        </div>

      </div>
    </div>
  );
}