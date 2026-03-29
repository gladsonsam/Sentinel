use serde_json::json;
use sysinfo::{Disks, System};

fn format_mac(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":")
}

pub fn collect_agent_info() -> serde_json::Value {
    let mut sys = System::new_all();
    sys.refresh_all();
    let app_version = env!("CARGO_PKG_VERSION").to_string();

    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".into());
    let os_name = System::name().unwrap_or_else(|| "Windows".into());
    let os_version = System::os_version();
    let os_long_version = System::long_os_version();
    let kernel_version = System::kernel_version();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();
    let cpu_cores = sys.cpus().len() as u32;

    // sysinfo 0.37 returns memory in bytes; convert to MB for the payload.
    let total_mem_mb = (sys.total_memory() / 1024 / 1024) as u64;
    let used_mem_mb = (sys.used_memory() / 1024 / 1024) as u64;
    let uptime_secs = System::uptime();

    let disks = Disks::new_with_refreshed_list();
    let drives: Vec<serde_json::Value> = disks
        .list()
        .iter()
        .map(|d| {
            let total = d.total_space();
            let avail = d.available_space();
            json!({
                "name": d.name().to_string_lossy().to_string(),
                "mount_point": d.mount_point().to_string_lossy().to_string(),
                "file_system": d.file_system().to_string_lossy().to_string(),
                "total_gb": ((total as f64) / 1024.0 / 1024.0 / 1024.0 * 100.0).round() / 100.0,
                "available_gb": ((avail as f64) / 1024.0 / 1024.0 / 1024.0 * 100.0).round() / 100.0,
            })
        })
        .collect();

    let adapters = ipconfig::get_adapters()
        .ok()
        .map(|list| {
            list.into_iter()
                .map(|a| {
                    let ips: Vec<String> = a
                        .ip_addresses()
                        .iter()
                        .map(|ip| ip.to_string())
                        .collect();
                    let gateways: Vec<String> = a
                        .gateways()
                        .iter()
                        .map(|ip| ip.to_string())
                        .collect();
                    let dns: Vec<String> = a.dns_servers().iter().map(|ip| ip.to_string()).collect();
                    let mac = a
                        .physical_address()
                        .map(format_mac)
                        .unwrap_or_default();

                    json!({
                        "name": a.friendly_name(),
                        "description": a.description(),
                        "mac": mac,
                        "ips": ips,
                        "gateways": gateways,
                        "dns": dns,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    json!({
        "type": "agent_info",
        "agent_version": app_version,
        "hostname": hostname,
        "uptime_secs": uptime_secs,
        "os_name": os_name,
        "os_version": os_version,
        "os_long_version": os_long_version,
        "kernel_version": kernel_version,
        "cpu_brand": cpu_brand,
        "cpu_cores": cpu_cores,
        "memory_total_mb": total_mem_mb,
        "memory_used_mb": used_mem_mb,
        "drives": drives,
        "adapters": adapters,
        "ts": crate::unix_timestamp_secs(),
    })
}
