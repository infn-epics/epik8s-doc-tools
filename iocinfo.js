#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
/*
http://<beamline>-dbwr.<epik8namespace>/dbwr/view.jsp?display=https://<beamline>-docs..<epik8namespace>/control/<ioc>/<bobfile>
*/

/**
 * Convert URLs in text to markdown links
 */
function makeUrlsClickable(text) {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlPattern, '[$1]($1)');
}
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
 * Find a file recursively in a directory
 */
function findFile(dir, filename) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            const found = findFile(fullPath, filename);
            if (found) return found;
        } else if (file === filename) {
            return fullPath;
        }
    }
    return null;
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
function main(iocinfoDir, controlDir, valuesFile = null, servicesDir = 'content/services', opiDir = null) {
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
        
        // Define iocDestPath if valuesFile is provided
        let iocDestPath = null;
        if (valuesFile) {
            iocDestPath = path.join(controlDir, iocName);
        }
        
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
            const url = `http://${beamline}-dbwr.${epik8namespace}/dbwr/view.jsp?display=https://${beamline}-docs.${epik8namespace}/control/${iocName}/${bobfile}`;
            bobLink = url;
        }
        
        // Check for OPI files from config
        const phoebusLinks = [];
        if (opiDir && iocConfigs[iocName]) {
            console.log(`Checking OPI for ${iocName}: opiDir=${opiDir}, opi=${iocConfigs[iocName]?.opi}`);
            if (iocConfigs[iocName].devices && iocConfigs[iocName].devices.length > 0) {
                // Per device
                for (const device of iocConfigs[iocName].devices) {
                    const deviceOpi = device.opi || iocConfigs[iocName].opi;
                    if (deviceOpi) {
                        let opiPath = path.join(opiDir, deviceOpi);
                        console.log(`Searching for OPI file for device ${device.name}: ${opiPath}`);
                        if (!fs.existsSync(opiPath)) {
                            // Try recursive search
                            const filename = path.basename(deviceOpi);
                            opiPath = findFile(opiDir, filename);
                            if (opiPath) {
                                console.log(`Found OPI file recursively: ${opiPath}`);
                            } else {
                                console.log(`OPI file not found: ${opiPath}`);
                                continue;
                            }
                        }
                        if (opiPath && fs.existsSync(opiPath)) {
                            const opiFile = path.basename(opiPath);
                            const relativePath = path.relative(controlDir, opiPath).replace(/\\/g, '/');
                            
                            // Create Phoebus link with macros
                            if (beamline && epik8namespace) {
                                let url = `http://${beamline}-dbwr.${epik8namespace}/dbwr/view.jsp?display=https://${beamline}-docs.${epik8namespace}/control/${relativePath}`;
                                const macros = {};
                                const iocprefix = iocConfigs[iocName].iocprefix || '';
                                if (iocprefix) {
                                    macros.P = iocprefix;
                                }
                                macros.R = device.name;
                                if (valuesFile) {
                                    macros.CONFFILE = valuesFile;
                                }
                                const macrosJson = JSON.stringify(macros);
                                const encodedMacros = encodeURIComponent(macrosJson);
                                url += `&macros=${encodedMacros}`;
                                phoebusLinks.push({ name: device.name, url: url });
                                console.log(`Created Phoebus link for ${device.name}: ${url}`);
                            }
                            
                            // No need to copy, link directly
                        }
                    }
                }
            }
            if (iocConfigs[iocName].opi && (!iocConfigs[iocName].devices || iocConfigs[iocName].devices.length === 0)) {
                console.log(`Condition met for IOC ${iocName}`);
                // IOC level
                let opiPath = path.join(opiDir, iocConfigs[iocName].opi);
                console.log(`Searching for OPI file for IOC ${iocName}: ${opiPath}`);
                if (!fs.existsSync(opiPath)) {
                    // Try recursive search
                    const filename = path.basename(iocConfigs[iocName].opi);
                    opiPath = findFile(opiDir, filename);
                    if (opiPath) {
                        console.log(`Found OPI file recursively: ${opiPath}`);
                    } else {
                        console.log(`OPI file not found: ${opiPath}`);
                    }
                }
                if (opiPath && fs.existsSync(opiPath)) {
                    const opiFile = path.basename(opiPath);
                    const relativePath = path.relative(controlDir, opiPath).replace(/\\/g, '/');
                    
                    // Create Phoebus link with macros
                    if (beamline && epik8namespace) {
                        let url = `http://${beamline}-dbwr.${epik8namespace}/dbwr/view.jsp?display=https://${beamline}-docs.${epik8namespace}/control/${relativePath}`;
                        const macros = {};
                        const iocprefix = iocConfigs[iocName].iocprefix || '';
                        if (iocprefix) {
                            macros.P = iocprefix;
                        }
                        macros.R = iocName;
                        if (valuesFile) {
                            macros.CONFFILE = valuesFile;
                        }
                        const macrosJson = JSON.stringify(macros);
                        const encodedMacros = encodeURIComponent(macrosJson);
                        url += `&macros=${encodedMacros}`;
                        phoebusLinks.push({ name: iocName, url: url });
                        console.log(`Created Phoebus link for ${iocName}: ${url}`);
                    }
                    
                    // No need to copy, link directly
                }
            }
        }
        
        // Check for .bob files in opi subdirectory
        const opiSubdir = path.join(iocPath, 'opi');
        if (fs.existsSync(opiSubdir)) {
            const bobFiles = fs.readdirSync(opiSubdir).filter(f => f.endsWith('.bob'));
            for (const bobFile of bobFiles) {
                if (beamline && epik8namespace) {
                    let url = `http://${beamline}-dbwr.${epik8namespace}/dbwr/view.jsp?display=https://${beamline}-docs.${epik8namespace}/control/${iocName}/${bobFile}`;
                    const macros = {};
                    const iocprefix = iocConfigs[iocName].iocprefix || '';
                    if (iocprefix) {
                        macros.P = iocprefix;
                    }
                    macros.R = iocName;
                    if (valuesFile) {
                        macros.CONFFILE = valuesFile;
                    }
                    const macrosJson = JSON.stringify(macros);
                    const encodedMacros = encodeURIComponent(macrosJson);
                    url += `&macros=${encodedMacros}`;
                    phoebusLinks.push({ name: bobFile.replace('.bob', ''), url: url });
                    console.log(`Created Phoebus link for ${bobFile} in opi subdir: ${url}`);
                }
            }
        }
        
        // Check for .bob files in global opiDir that match the IOC name
        if (opiDir) {
            const globalBobFiles = fs.readdirSync(opiDir).filter(f => f.endsWith('.bob') && f.toLowerCase().startsWith(iocName.toLowerCase()));
            for (const bobFile of globalBobFiles) {
                if (beamline && epik8namespace) {
                    const bobPath = path.join(opiDir, bobFile);
                    const relativePath = path.relative(controlDir, bobPath).replace(/\\/g, '/');
                    let url = `http://${beamline}-dbwr.${epik8namespace}/dbwr/view.jsp?display=https://${beamline}-docs.${epik8namespace}/control/${relativePath}`;
                    const macros = {};
                    const iocprefix = iocConfigs[iocName].iocprefix || '';
                    if (iocprefix) {
                        macros.P = iocprefix;
                    }
                    macros.R = iocName;
                    if (valuesFile) {
                        macros.CONFFILE = valuesFile;
                    }
                    const macrosJson = JSON.stringify(macros);
                    const encodedMacros = encodeURIComponent(macrosJson);
                    url += `&macros=${encodedMacros}`;
                    phoebusLinks.push({ name: bobFile.replace('.bob', ''), url: url });
                    console.log(`Created Phoebus link for global ${bobFile}: ${url}`);
                }
            }
        }
        
        // Generate markdown file
        const mdPath = path.join(controlDir, `${iocName}.md`);
        
        // Build navigation links
        const navLinks = [];
        if (iocAsset) {
            navLinks.push(`- [IOC Asset Documentation](${iocAsset})`);
        }
        if (phoebusLinks.length > 0) {
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
        if (phoebusLinks.length > 0) {
            phoebusSection = `
## Phoebus Display {#phoebus}

${phoebusLinks.map(link => `- [${link.name}](${link.url})`).join('\n')}

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
            // iocDestPath already defined above
            if (!fs.existsSync(iocDestPath)) {
                fs.mkdirSync(iocDestPath, { recursive: true });
            }
            // Copy files from iocPath to iocDestPath
            const allowedExtensions = ['.bob', '.yaml', '.txt', '.log', '.md','.html','.opi'];
            const files = fs.readdirSync(iocPath);
            for (const file of files) {
                const srcFile = path.join(iocPath, file);
                const destFile = path.join(iocDestPath, file);
                if (fs.statSync(srcFile).isFile() && allowedExtensions.includes(path.extname(srcFile))) {
                    fs.copyFileSync(srcFile, destFile);
                }
            }
            
            // Copy opi subdirectory if it exists
            const opiSrcPath = path.join(iocPath, 'opi');
            const opiDestPath = path.join(iocDestPath, 'opi');
            if (fs.existsSync(opiSrcPath)) {
                if (!fs.existsSync(opiDestPath)) {
                    fs.mkdirSync(opiDestPath, { recursive: true });
                }
                const opiFiles = fs.readdirSync(opiSrcPath).filter(f => allowedExtensions.includes(path.extname(f)));
                for (const file of opiFiles) {
                    fs.copyFileSync(path.join(opiSrcPath, file), path.join(opiDestPath, file));
                }
            }
            
            // Copy matched global .bob files - no longer needed, link directly
            // if (opiDir) {
            //     const globalBobFiles = fs.readdirSync(opiDir).filter(f => f.endsWith('.bob') && f.toLowerCase().startsWith(iocName.toLowerCase()));
            //     for (const bobFile of globalBobFiles) {
            //         const srcFile = path.join(opiDir, bobFile);
            //         const destFile = path.join(iocDestPath, bobFile);
            //         if (fs.existsSync(srcFile)) {
            //             fs.copyFileSync(srcFile, destFile);
            //         }
            //     }
            // }
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
    let opiDir = null;
    
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
        } else if (args[i] === '--opi-dir' && i + 1 < args.length) {
            opiDir = args[i + 1];
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log('Usage: node iocinfo.js [options]');
            console.log('');
            console.log('Options:');
            console.log('  --iocinfo-dir <path>   Directory containing IOC information (default: static/iocinfo)');
            console.log('  --control-dir <path>   Output directory for control documentation (default: content/control)');
            console.log('  --services-dir <path>  Output directory for services documentation (default: content/services)');
            console.log('  --values-file <path>   Path to values.yaml file to filter IOCs by epicsConfiguration.iocs list');
            console.log('  --opi-dir <path>       Directory containing OPI files referenced in IOC configurations');
            console.log('  --help, -h             Show this help message');
            process.exit(0);
        }
    }
    
    main(iocinfoDir, controlDir, valuesFile, servicesDir, opiDir);
}

module.exports = { main, extractIocMetadata, makeUrlsClickable };
