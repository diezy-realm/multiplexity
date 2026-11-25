use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const RESOURCE_SCRIPT: &str = r#"echo ===UPTIME_START===; uptime -p; echo ===UPTIME_END===
echo ===RAM_START===; free -b; echo ===RAM_END===
echo ===DISK_START===; df -B1 /; echo ===DISK_END===
echo ===CPU_START===; top -bn1 | grep -i Cpu | head -1; cat /proc/loadavg; echo ===CPU_END==="#;
pub const SERVICE_SCRIPT: &str = include_str!("service-scan.sh");
fn section<'a>(raw: &'a str, name: &str) -> &'a str {
    raw.split_once(&format!("==={name}_START==="))
        .and_then(|(_, x)| {
            x.split_once(&format!("==={name}_END==="))
                .map(|x| x.0.trim())
        })
        .unwrap_or("")
}
fn number(value: Option<&&str>) -> f64 {
    value
        .and_then(|x| x.trim_end_matches('%').parse().ok())
        .unwrap_or(0.)
}
pub fn resources(raw: &str) -> Value {
    let mem = section(raw, "RAM")
        .lines()
        .find(|x| x.to_lowercase().starts_with("mem:"))
        .map(|x| x.split_whitespace().skip(1).collect::<Vec<_>>())
        .unwrap_or_default();
    let total = number(mem.first());
    let free = if mem.len() >= 6 && number(mem.get(5)) > 0. {
        number(mem.get(5))
    } else {
        number(mem.get(2))
    };
    let used = if mem.len() >= 6 && number(mem.get(5)) > 0. {
        total - free
    } else {
        number(mem.get(1))
    };
    let disk = section(raw, "DISK")
        .lines()
        .nth(1)
        .map(|x| x.split_whitespace().collect::<Vec<_>>())
        .unwrap_or_default();
    let cpu = section(raw, "CPU");
    let idle = regex::Regex::new(r"([\d.,]+)\s*id")
        .ok()
        .and_then(|re| re.captures(cpu))
        .and_then(|x| x.get(1))
        .and_then(|x| x.as_str().replace(',', ".").parse::<f64>().ok());
    let load = cpu
        .lines()
        .find_map(|line| {
            let v: Vec<f64> = line
                .split_whitespace()
                .take(3)
                .filter_map(|x| x.parse().ok())
                .collect();
            (v.len() == 3 && !line.contains("Cpu")).then_some(v)
        })
        .unwrap_or(vec![0.; 3]);
    let percent = idle
        .map(|x| ((100. - x) * 10.).round() / 10.)
        .unwrap_or_else(|| (load[0] * 25.).round())
        .clamp(0., 100.);
    json!({"cpuPercent":percent,"loadAvg":load,"uptime":section(raw,"UPTIME"),"ram":{"totalBytes":total,"usedBytes":used,"freeBytes":free,"percent":if total>0.{(used/total*100.).round().clamp(0.,100.)}else{0.}},"disk":{"totalBytes":number(disk.get(1)),"usedBytes":number(disk.get(2)),"freeBytes":number(disk.get(3)),"percent":number(disk.get(4)),"mount":disk.get(5).copied().unwrap_or("/")}})
}
pub fn services(raw: &str) -> Vec<Value> {
    let mut details: BTreeMap<u64, Vec<String>> = BTreeMap::new();
    for line in section(raw, "PID_DETAILS")
        .lines()
        .chain(section(raw, "WORKERS").lines())
    {
        let parts: Vec<_> = line.splitn(5, '|').map(str::to_owned).collect();
        if parts.len() == 5
            && let Ok(pid) = parts[0].parse()
        {
            details.insert(pid, parts);
        }
    }
    let mut ports: BTreeMap<u64, BTreeSet<String>> = BTreeMap::new();
    let mut names = BTreeMap::new();
    let pid_re = regex::Regex::new(r#""([^"]+)",pid=(\d+)"#).ok();
    let port_re = regex::Regex::new(r":(\d+)\s").ok();
    for line in section(raw, "NET").lines() {
        let port = port_re
            .as_ref()
            .and_then(|x| x.captures(line))
            .and_then(|x| x.get(1))
            .map(|x| x.as_str().to_owned());
        if let Some(re) = &pid_re {
            for cap in re.captures_iter(line) {
                let pid = cap[2].parse::<u64>().unwrap_or(0);
                names.insert(pid, cap[1].to_owned());
                if let Some(port) = &port {
                    ports.entry(pid).or_default().insert(port.clone());
                }
            }
        }
    }
    for (pid, name) in &names {
        details.entry(*pid).or_insert_with(|| {
            vec![
                pid.to_string(),
                String::new(),
                String::new(),
                name.clone(),
                String::new(),
            ]
        });
    }
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    for block in section(raw, "SYSTEMD").split("\n\n") {
        let props: BTreeMap<_, _> = block
            .lines()
            .filter_map(|line| line.split_once('='))
            .collect();
        if let Some(id) = props.get("Id") {
            let pid = props
                .get("MainPID")
                .and_then(|x| x.parse::<u64>().ok())
                .unwrap_or(0);
            seen.insert(pid);
            let extra = details.get(&pid);
            let p = ports.get(&pid).cloned().unwrap_or_default();
            let exec = props.get("ExecStart").copied().unwrap_or("");
            let exec = exec
                .split("path=")
                .nth(1)
                .and_then(|x| x.split(" ;").next())
                .unwrap_or(exec);
            result.push(json!({"id":id,"name":id.trim_end_matches(".service"),"type":"systemd","status":props.get("ActiveState").copied().unwrap_or("running"),"pid":pid,"ports":p,"description":props.get("Description"),"workingDir":props.get("WorkingDirectory").copied().filter(|x|!x.is_empty()).or_else(||extra.map(|x|x[2].as_str())).unwrap_or(""),"execPath":exec,"unitFile":props.get("FragmentPath"),"user":extra.map(|x|x[1].as_str()).unwrap_or(""),"cmdline":extra.map(|x|x[4].as_str()).unwrap_or("")}));
        }
    }
    for item in &mut result {
        let pid = item["pid"].as_u64().unwrap_or(0);
        if let Some(name) = names.get(&pid) {
            item["id"] = json!(format!("listen-{pid}"));
            item["name"] = json!(name);
            item["type"] = json!("listening");
            item["status"] = json!("running");
        } else {
            let unit = item["id"].as_str().unwrap_or("").to_owned();
            item["id"] = json!(format!("systemd-{unit}"));
            item["name"] = json!(unit);
        }
    }
    for (pid, detail) in &details {
        if seen.contains(pid) {
            continue;
        }
        let p = ports.get(pid).cloned().unwrap_or_default();
        let kind = if p.is_empty() { "worker" } else { "listening" };
        result.push(json!({"id":format!("{}-{pid}",if kind=="listening"{"listen"}else{"worker"}),"name":names.get(pid).cloned().unwrap_or_else(||detail[3].rsplit('/').next().unwrap_or("worker").into()),"type":kind,"status":"running","pid":pid,"ports":p,"workingDir":detail[2],"execPath":detail[3],"cmdline":detail[4],"user":detail[1]}));
    }
    let docker_ports = regex::Regex::new(r":(\d+)->").ok();
    for line in section(raw, "DOCKER").lines() {
        let p: Vec<_> = line.split('|').collect();
        if p.len() >= 5 {
            let ports: Vec<_> = docker_ports
                .as_ref()
                .map(|re| {
                    re.captures_iter(p[4])
                        .map(|cap| cap[1].to_owned())
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect()
                })
                .unwrap_or_default();
            result.push(json!({"id":format!("docker-{}",p[0]),"name":p[1],"type":"docker","image":p[2],"status":p[3],"ports":ports,"description":format!("Docker Image: {}",p[2])}));
        }
    }
    for line in section(raw, "WEB_ROOTS").lines() {
        let p: Vec<_> = line.split('|').collect();
        if p.len() >= 4
            && !result
                .iter()
                .any(|x| x["workingDir"] == p[1] && x["type"] != "listening")
        {
            result.push(json!({"id":format!("web-{}",p[0].replace('/',"-")),"name":format!("{} (Web/PHP)",p[0]),"type":"web","status":"active","workingDir":p[1],"description":format!("Web Application / DocumentRoot ({} item)",p[2]),"user":p[3],"ports":[]}));
        }
    }
    result.sort_by_key(|item| match item["type"].as_str() {
        Some("listening") => 0,
        Some("systemd") => 1,
        Some("worker") => 2,
        Some("docker") => 3,
        _ => 4,
    });
    result
}
pub fn logs(raw: &str) -> Vec<Value> {
    let re = regex::Regex::new(
        r"^(ERROR|DEBUG|INFO|ALL)\s+-\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+-->\s+(.+)$",
    )
    .ok();
    raw.lines()
        .filter_map(|x| {
            let x = x.trim();
            if x.is_empty() || x.starts_with("<?php") {
                return None;
            }
            Some(if let Some(c) = re.as_ref().and_then(|re| re.captures(x)) {
                json!({"level":&c[1],"timestamp":&c[2],"message":&c[3],"raw":x})
            } else {
                json!({"level":"ALL","timestamp":"","message":x,"raw":x})
            })
        })
        .collect()
}
pub fn is_config(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        ".env",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".ini",
        ".conf",
        ".config",
        ".xml",
        ".properties",
    ]
    .iter()
    .any(|x| n.ends_with(x))
        || n.starts_with(".env")
}
pub fn is_code(name: &str) -> bool {
    [
        ".go", ".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".php", ".java", ".sh", ".sql",
    ]
    .iter()
    .any(|x| name.ends_with(x))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resource_available_memory_is_used() {
        let value = resources(
            "===RAM_START===\nMem: 1000 600 100 0 100 300\n===RAM_END===\n===DISK_START===\nFilesystem 1B-blocks Used Available Use% Mounted\n/dev/a 2000 1000 1000 50% /\n===DISK_END===\n===CPU_START===\n%Cpu(s): 10 us, 90 id\n0.1 0.2 0.3 1/20 1\n===CPU_END===",
        );
        assert_eq!(value["ram"]["usedBytes"], 700.);
        assert_eq!(value["disk"]["percent"], 50.);
        assert_eq!(value["cpuPercent"], 10.);
    }
    #[test]
    fn log_guard_and_multiline_are_preserved() {
        let parsed = logs("<?php exit; ?>\nERROR - 2026-11-25 10:00:00 --> failed\n stack line\n");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0]["level"], "ERROR");
        assert_eq!(parsed[1]["level"], "ALL");
    }
}
