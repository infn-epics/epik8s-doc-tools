#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
/*
http://<beamline>-dbwr.<epik8namespace>/dbwr/view.jsp?display=https://<beamline>-docs..<epik8namespace>/control/<ioc>/<bobfile>
*/
/**
 * Extract metadata from start.log file
 */
function extractIocMetadata(startLogPath) {
    const metadata = {};
    if (fs.existsSync(startLogPath)) {
        const content = fs.readFileSync(startLogPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.includes(':')) {
                const [key, ...valueParts] = line.split(':');
                metadata[key.trim()] = valueParts.join(':').trim();
            }
        }
    }
    return metadata;
}

/**
 * Convert URLs in text to markdown links
 */
function makeUrlsClickable(text) {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlPattern, '[$1]($1)');
}

/**
 * Load the list of IOCs from values.yaml
 */
function loadIocList(valuesFile) {
    const content = fs.readFileSync(valuesFile, 'utf8');
    const values = yaml.parse(content);
    return {
        iocs: values.epicsConfiguration?.iocs || [],
        beamline: values.beamline || '',
        epik8namespace: values.epik8namespace || ''
    };
}

/**
 * Load services from values.yaml that have ingress enabled
 */
function loadServicesWithIngress(valuesFile) {
    const content = fs.readFileSync(valuesFile, 'utf8');
    const values = yaml.parse(content);
    
    const services = [];
    const beamline = values.beamline || '';
    const epik8namespace = values.epik8namespace || '';
    
    const epicsServices = values.epicsConfiguration?.services || {};
    for (const [serviceName, serviceConfig] of Object.entries(epicsServices)) {
        // Check if service has ingress enabled OR has a loadbalancer
        if (serviceConfig.enable_ingress || serviceConfig.ingress?.enabled || serviceConfig.loadbalancer) {
            // Determine the URL based on loadbalancer or standard URL format
            let url;
            if (serviceConfig.loadbalancer) {
                url = `http://${serviceConfig.loadbalancer}`;
            } else {
                const beamline = values.beamline || '';
                const epik8namespace = values.epik8namespace || '';
                url = `http://${beamline}-${serviceName}.${epik8namespace}`;
            }
            
            // Add path if specified
            if (serviceConfig.path) {
                url += serviceConfig.path;
            }
            
            services.push({
                name: serviceName,
                config: serviceConfig,
                url: url
            });
        }
    }
    
    return services;
}

/**
 * Generate IOC documentation pages
 */
function main(iocinfoDir, controlDir, valuesFile = null, servicesDir = 'content/services') {
    // Load IOC list from values.yaml if provided
    let allowedIocs = null;
    let iocConfigs = {};
    let services = [];
    let beamline = '';
    let epik8namespace = '';
    if (valuesFile) {
        const data = loadIocList(valuesFile);
        const iocsData = data.iocs;
        beamline = data.beamline;
        epik8namespace = data.epik8namespace;
        allowedIocs = iocsData.map(ioc => ioc.name);
        iocConfigs = iocsData.reduce((acc, ioc) => {
            acc[ioc.name] = ioc;
            return acc;
        }, {});
        services = loadServicesWithIngress(valuesFile);
        console.log(`Filtering to IOCs listed in ${valuesFile}: ${allowedIocs}`);
        console.log(`Found ${services.length} services with ingress enabled`);
    }
    
    // Get all IOC directories
    const iocDirs = fs.readdirSync(iocinfoDir)
        .filter(d => fs.statSync(path.join(iocinfoDir, d)).isDirectory());
    
    // Filter IOCs if list is provided
    let filteredIocDirs = iocDirs;
    if (allowedIocs) {
        filteredIocDirs = iocDirs.filter(ioc => allowedIocs.includes(ioc));
        console.log(`Processing ${filteredIocDirs.length} IOCs: ${filteredIocDirs}`);
    }

    for (const iocName of filteredIocDirs) {
        const iocPath = path.join(iocinfoDir, iocName);
        const startLog = path.join(iocPath, 'start.log');
        
        // Extract metadata
        const metadata = extractIocMetadata(startLog);
        const devgroup = metadata['IOC Device Group'] || 'other';
        const iocAsset = metadata['IOC Asset'] || '';
        
        // Get IOC description if available
        let iocDesc = '';
        if (iocConfigs[iocName] && iocConfigs[iocName].desc) {
            iocDesc = iocConfigs[iocName].desc;
        }
        
        // Read start.log
        let startLogContent = '';
        if (fs.existsSync(startLog)) {
            startLogContent = makeUrlsClickable(fs.readFileSync(startLog, 'utf8'));
        }
        
        // Find YAML file
        const yamlFiles = fs.readdirSync(iocPath).filter(f => f.endsWith('.yaml'));
        let yamlContent = '';
        
        if (yamlFiles.length > 0) {
            const yamlPath = path.join(iocPath, yamlFiles[0]);
            yamlContent = fs.readFileSync(yamlPath, 'utf8');
        }
        
        // Read st.cmd if present
        let stcmdContent = '';
        const stcmdPath = path.join(iocPath, 'st.cmd');
        if (fs.existsSync(stcmdPath)) {
            stcmdContent = fs.readFileSync(stcmdPath, 'utf8');
        }
        
        // Read pvlist.txt
        let pvlistContent = '';
        let pvCount = 0;
        const pvlistPath = path.join(iocPath, 'pvlist.txt');
        if (fs.existsSync(pvlistPath)) {
            pvlistContent = fs.readFileSync(pvlistPath, 'utf8');
            pvCount = pvlistContent.trim().split('\n').filter(line => line.trim()).length;
        }
        
        // Check for .bob files
        let bobLink = '';
        const bobFiles = fs.readdirSync(iocPath).filter(f => f.endsWith('.bob'));
        if (bobFiles.length > 0 && beamline && epik8namespace) {
            const bobfile = bobFiles[0]; // Take the first one
            const url = `http://${beamline}-dbwr.${epik8namespace}/dbwr/view.jsp?display=https://${beamline}-docs..${epik8namespace}/control/${iocName}/${bobfile}`;
            bobLink = url;
        }
        
        // Generate markdown file
        const mdPath = path.join(controlDir, `${iocName}.md`);
        
        // Build navigation links
        const navLinks = [];
        if (iocAsset) {
            navLinks.push(`- [IOC Asset Documentation](${iocAsset})`);
        }
        if (bobLink) {
            navLinks.push('- [Phoebus Display](#phoebus)');
        }
        navLinks.push('- [Start Log](#startlog)');
        if (yamlContent) {
            navLinks.push('- [Configuration (YAML)](#yaml)');
        }
        if (stcmdContent) {
            navLinks.push('- [EPICS st.cmd](#stcmd)');
        }
        if (pvlistContent) {
            navLinks.push(`- [Process Variables (${pvCount})](#pvlist)`);
        }
        
        let yamlSection = '';
        if (yamlContent) {
            yamlSection = `
## Configuration (YAML) {#yaml}

\`\`\`yaml
${yamlContent}
\`\`\`
`;
        }
        
        let stcmdSection = '';
        if (stcmdContent) {
            stcmdSection = `
## EPICS st.cmd {#stcmd}

\`\`\`bash
${stcmdContent}
\`\`\`
`;
        }
        
        let pvlistSection = '';
        if (pvlistContent) {
            pvlistSection = `
## Process Variables (${pvCount}) {#pvlist}

\`\`\`text
${pvlistContent}
\`\`\`
`;
        }
        
        let descSection = '';
        if (iocDesc) {
            descSection = `
## Description

${iocDesc}

`;
        }
        
        let phoebusSection = '';
        if (bobLink) {
            phoebusSection = `
## Phoebus Display {#phoebus}

[View in Phoebus](${bobLink})

`;
        }
        
        const mdContent = `---
title: "${iocName}"
linkTitle: "${iocName}"
weight: 10
devgroup: "${devgroup}"
type: docs
date: "${new Date().toISOString()}"
---

## Quick Navigation

${navLinks.join('\n')}

## Start Log {#startlog}

\`\`\`
${startLogContent}
\`\`\`
${descSection}${phoebusSection}${yamlSection}${stcmdSection}${pvlistSection}
`;
        
        // Ensure control directory exists
        if (!fs.existsSync(controlDir)) {
            fs.mkdirSync(controlDir, { recursive: true });
        }
        
        fs.writeFileSync(mdPath, mdContent);
        
        // Copy IOC directory to control directory only if valuesFile is provided (filtered IOCs)
        if (valuesFile) {
            const iocDestPath = path.join(controlDir, iocName);
            if (!fs.existsSync(iocDestPath)) {
                fs.mkdirSync(iocDestPath, { recursive: true });
            }
            // Copy files from iocPath to iocDestPath
            const files = fs.readdirSync(iocPath);
            for (const file of files) {
                const srcFile = path.join(iocPath, file);
                const destFile = path.join(iocDestPath, file);
                if (fs.statSync(srcFile).isFile()) {
                    fs.copyFileSync(srcFile, destFile);
                }
            }
        }
        
        const assetInfo = iocAsset ? ` | Asset: ${iocAsset.substring(0, 40)}...` : '';
        console.log(`Updated: ${mdPath} (PVs: ${pvCount})${assetInfo}`);
    }

    // Generate documentation for services with ingress
    for (const service of services) {
        const serviceName = service.name;
        const serviceUrl = service.url;
        const serviceConfig = service.config;
        
        // Get service description if available
        const serviceDesc = serviceConfig.desc || 'This is an EPICS service with ingress enabled.';
        
        // Determine if this is a loadbalancer-only service (no ingress)
        const hasIngress = serviceConfig.enable_ingress || serviceConfig.ingress?.enabled;
        const hasLoadbalancer = !!serviceConfig.loadbalancer;
        
        const mdPath = path.join(servicesDir, `${serviceName}.md`);
        
        // Format the connection info based on ingress availability
        let connectionInfo;
        if (hasLoadbalancer && !hasIngress) {
            // Load balancer only - show IP address
            connectionInfo = `**Connection IP:** ${serviceConfig.loadbalancer}`;
        } else {
            // Ingress enabled - show clickable URL
            connectionInfo = `## Service URL

[${serviceUrl}](${serviceUrl})`;
        }
        
        const mdContent = `---
title: "${serviceName}"
linkTitle: "${serviceName}"
weight: 10
type: docs
date: "${new Date().toISOString()}"
---

${connectionInfo}

## Description

${serviceDesc}
`;
        
        // Ensure services directory exists
        if (!fs.existsSync(servicesDir)) {
            fs.mkdirSync(servicesDir, { recursive: true });
        }
        
        fs.writeFileSync(mdPath, mdContent);
        
        console.log(`Updated: ${mdPath} (Service: ${serviceUrl})`);
    }

    console.log('Done!');
}

// Parse command line arguments
if (require.main === module) {
    const args = process.argv.slice(2);
    let iocinfoDir = 'static/iocinfo';
    let controlDir = 'content/control';
    let servicesDir = 'content/services';
    let valuesFile = null;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--iocinfo-dir' && i + 1 < args.length) {
            iocinfoDir = args[i + 1];
            i++;
        } else if (args[i] === '--control-dir' && i + 1 < args.length) {
            controlDir = args[i + 1];
            i++;
        } else if (args[i] === '--services-dir' && i + 1 < args.length) {
            servicesDir = args[i + 1];
            i++;
        } else if (args[i] === '--values-file' && i + 1 < args.length) {
            valuesFile = args[i + 1];
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log('Usage: node iocinfo.js [options]');
            console.log('');
            console.log('Options:');
            console.log('  --iocinfo-dir <path>   Directory containing IOC information (default: static/iocinfo)');
            console.log('  --control-dir <path>   Output directory for control documentation (default: content/control)');
            console.log('  --services-dir <path>  Output directory for services documentation (default: content/services)');
            console.log('  --values-file <path>   Path to values.yaml file to filter IOCs by epicsConfiguration.iocs list');
            console.log('  --help, -h             Show this help message');
            process.exit(0);
        }
    }
    
    main(iocinfoDir, controlDir, valuesFile, servicesDir);
}

module.exports = { main, extractIocMetadata, makeUrlsClickable };
