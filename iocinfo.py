import os
import re
import argparse
import yaml
from datetime import datetime

def extract_ioc_metadata(start_log_path):
    """Extract metadata from start.log file"""
    metadata = {}
    if os.path.exists(start_log_path):
        with open(start_log_path, 'r') as f:
            for line in f:
                if ':' in line:
                    key, value = line.split(':', 1)
                    metadata[key.strip()] = value.strip()
    return metadata

def make_urls_clickable(text):
    """Convert URLs in text to markdown links"""
    url_pattern = r'(https?://[^\s]+)'
    return re.sub(url_pattern, r'[\1](\1)', text)

def load_ioc_list(values_file):
    """Load the list of IOCs from values.yaml"""
    with open(values_file, 'r') as f:
        values = yaml.safe_load(f)
    return values.get('epicsConfiguration', {}).get('iocs', [])

def load_services_with_ingress(values_file):
    """Load services from values.yaml that have ingress enabled"""
    with open(values_file, 'r') as f:
        values = yaml.safe_load(f)
    
    services = []
    beamline = values.get('beamline', '')
    epik8namespace = values.get('epik8namespace', '')
    
    epics_services = values.get('epicsConfiguration', {}).get('services', {})
    for service_name, service_config in epics_services.items():
        # Check if service has ingress enabled OR has a loadbalancer
        if service_config.get('enable_ingress') or service_config.get('ingress', {}).get('enabled') or 'loadbalancer' in service_config:
            # Determine the URL based on loadbalancer or standard URL format
            if 'loadbalancer' in service_config:
                url = f"http://{service_config['loadbalancer']}"
            else:
                beamline = values.get('beamline', '')
                epik8namespace = values.get('epik8namespace', '')
                url = f"http://{beamline}-{service_name}.{epik8namespace}"
            
            # Add path if specified
            if 'path' in service_config:
                url += service_config['path']
            
            services.append({
                'name': service_name,
                'config': service_config,
                'url': url
            })
    
    return services

def main(iocinfo_dir, control_dir, values_file=None, services_dir=None):
    """Generate IOC documentation pages"""
    # Load IOC list from values.yaml if provided
    allowed_iocs = None
    ioc_configs = {}
    services = []
    if values_file:
        iocs_data = load_ioc_list(values_file)
        allowed_iocs = [ioc['name'] for ioc in iocs_data]
        ioc_configs = {ioc['name']: ioc for ioc in iocs_data}
        services = load_services_with_ingress(values_file)
        print(f"Filtering to IOCs listed in {values_file}: {allowed_iocs}")
        print(f"Found {len(services)} services with ingress enabled")
    
    # Get all IOC directories
    ioc_dirs = [d for d in os.listdir(iocinfo_dir) 
                if os.path.isdir(os.path.join(iocinfo_dir, d))]
    
    # Filter IOCs if list is provided
    if allowed_iocs:
        ioc_dirs = [ioc for ioc in ioc_dirs if ioc in allowed_iocs]
        print(f"Processing {len(ioc_dirs)} IOCs: {ioc_dirs}")

    for ioc_name in ioc_dirs:
        ioc_path = os.path.join(iocinfo_dir, ioc_name)
        start_log = os.path.join(ioc_path, "start.log")
        
        # Extract metadata
        metadata = extract_ioc_metadata(start_log)
        devgroup = metadata.get('IOC Device Group', 'other')
        ioc_asset = metadata.get('IOC Asset', '')
        
        # Read start.log
        start_log_content = ""
        if os.path.exists(start_log):
            with open(start_log, 'r') as f:
                start_log_content = make_urls_clickable(f.read())
        
        # Find YAML file
        yaml_files = [f for f in os.listdir(ioc_path) if f.endswith('.yaml')]
        yaml_content = ""
        
        if yaml_files:
            yaml_path = os.path.join(ioc_path, yaml_files[0])
            with open(yaml_path, 'r') as f:
                yaml_content = f.read()
        
        # Read st.cmd if present
        stcmd_content = ""
        stcmd_path = os.path.join(ioc_path, "st.cmd")
        if os.path.exists(stcmd_path):
            with open(stcmd_path, 'r') as f:
                stcmd_content = f.read()
        
        # Read pvlist.txt
        pvlist_content = ""
        pv_count = 0
        pvlist_path = os.path.join(ioc_path, "pvlist.txt")
        if os.path.exists(pvlist_path):
            with open(pvlist_path, 'r') as f:
                pvlist_content = f.read()
                pv_count = len([line for line in pvlist_content.strip().split('\n') if line.strip()])
        
        # Generate markdown file
        md_path = os.path.join(control_dir, f"{ioc_name}.md")
        
        # Get IOC description if available
        ioc_desc = ""
        if ioc_name in ioc_configs and 'desc' in ioc_configs[ioc_name]:
            ioc_desc = ioc_configs[ioc_name]['desc']
        
        # Build navigation links
        nav_links = []
        if ioc_asset:
            nav_links.append(f"- [IOC Asset Documentation]({ioc_asset})")
        nav_links.append("- [Start Log](#startlog)")
        if yaml_content:
            nav_links.append("- [Configuration (YAML)](#yaml)")
        if stcmd_content:
            nav_links.append("- [EPICS st.cmd](#stcmd)")
        if pvlist_content:
            nav_links.append(f"- [Process Variables ({pv_count})](#pvlist)")
        
        yaml_section = ""
        if yaml_content:
            yaml_section = f"""
## Configuration (YAML) {{#yaml}}

```yaml
{yaml_content}
```
"""
        
        stcmd_section = ""
        if stcmd_content:
            stcmd_section = f"""
## EPICS st.cmd {{#stcmd}}

```bash
{stcmd_content}
```
"""
        
        pvlist_section = ""
        if pvlist_content:
            pvlist_section = f"""
## Process Variables ({pv_count}) {{#pvlist}}

```text
{pvlist_content}
```
"""
        
        desc_section = ""
        if ioc_desc:
            desc_section = f"""
## Description

{ioc_desc}

"""
        
        md_content = f"""---
title: "{ioc_name}"
linkTitle: "{ioc_name}"
weight: 10
devgroup: "{devgroup}"
date: "{datetime.now().isoformat()}"
---

## Quick Navigation

{chr(10).join(nav_links)}

## Start Log {{#startlog}}

```
{start_log_content}
```
{desc_section}{yaml_section}{stcmd_section}{pvlist_section}
"""
        
        with open(md_path, 'w') as f:
            f.write(md_content)
        
        asset_info = f" | Asset: {ioc_asset[:40]}..." if ioc_asset else ""
        print(f"Updated: {md_path} (PVs: {pv_count}){asset_info}")

    # Generate documentation for services with ingress
    for service in services:
        service_name = service['name']
        service_url = service['url']
        service_config = service['config']
        
        # Get service description if available
        service_desc = service_config.get('desc', 'This is an EPICS service with ingress enabled.')
        
        # Determine if this is a loadbalancer-only service (no ingress)
        has_ingress = service_config.get('enable_ingress') or service_config.get('ingress', {}).get('enabled')
        has_loadbalancer = 'loadbalancer' in service_config
        
        md_path = os.path.join(services_dir, f"{service_name}.md")
        
        # Format the connection info based on ingress availability
        if has_loadbalancer and not has_ingress:
            # Load balancer only - show IP address
            connection_info = f"**Connection IP:** {service_config['loadbalancer']}"
        else:
            # Ingress enabled - show clickable URL
            connection_info = f"## Service URL\n\n[{service_url}]({service_url})"
        
        md_content = f"""---
title: "{service_name}"
linkTitle: "{service_name}"
weight: 10
type: docs
date: "{datetime.now().isoformat()}"
---

{connection_info}

## Description

{service_desc}
"""
        
        # Ensure services directory exists
        os.makedirs(services_dir, exist_ok=True)
        
        with open(md_path, 'w') as f:
            f.write(md_content)
        
        print(f"Updated: {md_path} (Service: {service_url})")

    print("Done!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Generate IOC documentation pages from iocinfo directory')
    parser.add_argument('--iocinfo-dir', default='static/iocinfo',
                        help='Directory containing IOC information (default: static/iocinfo)')
    parser.add_argument('--control-dir', default='content/control',
                        help='Output directory for control documentation (default: content/control)')
    parser.add_argument('--services-dir', default='content/services',
                        help='Output directory for services documentation (default: content/services)')
    parser.add_argument('--values-file', 
                        help='Path to values.yaml file to filter IOCs by epicsConfiguration.iocs list')
    
    args = parser.parse_args()
    main(args.iocinfo_dir, args.control_dir, args.values_file, args.services_dir)
