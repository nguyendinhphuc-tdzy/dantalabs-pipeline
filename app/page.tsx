import { supabase } from "@/lib/supabase/client";
import { StatsOverview } from "@/components/features/pipeline/stats-overview";
import { CompanyTable } from "@/components/features/pipeline/company-table";
import { Company } from "@/types/database";
import { ScanDialog } from "@/components/features/pipeline/scan-dialog";
// Import Component Biểu đồ mới
import { PipelineAnalytics } from "@/components/features/pipeline/pipeline-analytics";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  console.log("🚀 Dashboard: Attempting to fetch data...");

  // 1. Gọi dữ liệu Companies (Công ty)
  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('*')
    .order('created_at', { ascending: false });

  // 2. Gọi dữ liệu Contacts (Người liên hệ) - MỚI
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

        {/* Phần thống kê số liệu (Cards) */}
        <StatsOverview data={typedCompanies} />

        {/* --- PHẦN MỚI: BIỂU ĐỒ ANALYTICS --- */}
        {/* Hiển thị Phễu chuyển đổi và Tỷ lệ chất lượng Lead */}
        <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Performance Analytics</h2>
            <PipelineAnalytics companies={typedCompanies} contacts={typedContacts} />
        </div>

        {/* Bảng dữ liệu */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-900">Recent Companies</h2>
          <CompanyTable data={typedCompanies} />
        </div>

      </div>
    </div>
  );
}