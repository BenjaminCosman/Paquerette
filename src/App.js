import React, { useState, useRef, useEffect } from 'react';
import Graph from 'react-graph-vis';

const MERGED_METANODE_COLOR = "#ADD8E6";
const UNMERGED_METANODE_COLOR = "#FFB6C1";

const BunnyGraph = () => {
    const [originalData, setOriginalData] = useState({ nodes: [], edges: [] });
    const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
    const [graphKey, setGraphKey] = useState(0);
    const [isMergingEnabled, setIsMergingEnabled] = useState(false);
    const [suggestedPairs, setSuggestedPairs] = useState([]);
    const [foundPrefixes, setFoundPrefixes] = useState(new Set());
    const [selectedPrefixes, setSelectedPrefixes] = useState(new Set());
    const standardPrefixes = new Set(['N', 'W', 'E', 'S', 'C', 'NW?', 'NE?', 'SW?', 'SE?']);
    const [graphOptions, setGraphOptions] = useState({
        // TODO: add 'manipulation' option to allow editing the graph?
        // TODO: add a way to pin nodes in place?
        autoResize: true, // Note: this causes problems when configure mode is uncommented
        nodes: {
            opacity: 0.5,
        },
        edges: {
            arrows: '' // disable arrowheads on edges
        },
        interaction: {
            keyboard: {
              enabled: true
            },
            multiselect: true
        },
        // uncomment configure to play with tons of options!
        // configure: {
        //     enabled: true,
        //     showButton: true,
        //     container: undefined,
        // }
    });

    // // only relevant if 'configure' is set to true in the graph options
    // const configContainerRef = useRef(null);
    // useEffect(() => {
    //     // Clear any existing configuration to prevent duplication //TODO: this doesn't seem to actually work
    //     if (configContainerRef.current) {
    //         configContainerRef.current.innerHTML = '';
    //     }
    //     // Update the graph options with the ref to the container
    //     setGraphOptions((prevOptions) => ({
    //         ...prevOptions,
    //         configure: {
    //             ...prevOptions.configure,
    //             container: configContainerRef.current,
    //         },
    //     }));
    // }, []); // Empty dependency array should theoretically ensure this runs only once after initial render??

    useEffect(() => {
        const handleKeyDown = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
                handleLoadClipboard(isMergingEnabled);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => { // Cleanup
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isMergingEnabled]); // Add isMergingEnabled as a dependency

    const handleLoadClipboard = (isMerging) => {
        navigator.clipboard.readText()
            .then(text => {
                const newOriginalData = parseRawInput(text);
                setOriginalData(newOriginalData);
                setSelectedPrefixes(new Set());  // Reset selected prefixes
            })
            .catch(err => console.error('Failed to read clipboard contents: ', err));
    };

    const parseRawInput = (text) => {
        const pairs = text.split('\n').map(line => line.trim().split(' x '));
        let nodes = new Set();
        let edges = [];
        let prefixes = new Set();
        pairs.forEach(pair => {
            // Filter out any pairs that are not exactly two strings
            // TODO: throw error instead of silently filtering?
            if (pair.length === 2) {
                const [b0, b1] = pair;
                prefixes.add(b0.split('-')[0]);
                prefixes.add(b1.split('-')[0]);
                nodes.add(b0);
                nodes.add(b1);
                edges.push({ from: b0, to: b1 });
            }
        });
        setFoundPrefixes(prefixes);
        return {
            nodes: nodes,
            edges: edges
        };
    };

    const updateGraph = (newData, useMerging) => {
        let nodes = Array.from(newData.nodes);
        let edges = newData.edges;

        // Apply prefix filtering if any checkboxes are selected
        if (selectedPrefixes.size > 0) {
            const prefixSet = new Set(selectedPrefixes);
            // If "Base game" is selected, add all standard prefixes
            if (prefixSet.has('Base game')) {
                standardPrefixes.forEach(p => prefixSet.add(p));
                prefixSet.delete('Base game');
            }

            // Filter nodes and edges based on selected prefixes
            nodes = nodes.filter(node => {
                const prefix = node.split('-')[0];
                return prefixSet.has(prefix);
            });
            const nodeSet = new Set(nodes);
            edges = edges.filter(edge =>
                nodeSet.has(edge.from) && nodeSet.has(edge.to)
            );
        }

        // Now process the filtered data
        if (!useMerging) {
            nodes = nodes.map(node => ({ id: node, label: node }));
            setGraphData({ nodes: nodes, edges: edges });
        } else {
            const processedGraph = createMergedGraph(nodes, edges);
            setGraphData(processedGraph);
        }
        setGraphKey(prevKey => prevKey + 1);
    };

    const createMergedGraph = (nodes, edges) => {
        let labels = Object.fromEntries(Array.from(nodes).map(node => [node, [new Set([node])]]));
        let adj = Object.fromEntries(Array.from(nodes).map(node => [node, new Set([node])]));
        edges.forEach(edge => {
            adj[edge.from].add(edge.to);
            adj[edge.to].add(edge.from);
        });

        let changed = true;
        while (changed) {
            changed = false;
            for (const [b0, b1] of combinations(Object.keys(adj), 2)) {
                if (adj[b0].has(b1) && setEquals(adj[b0], adj[b1])) {
                    labels[b0][0] = new Set([...labels[b0][0], ...labels[b1][0]]);
                    delete adj[b1];
                    Object.values(adj).forEach(set => set.delete(b1));
                    changed = true;
                    break;
                }
            }
        }

        // remove self-loops
        Object.keys(adj).forEach(k => {
            adj[k].delete(k);
        });

        changed = true;
        while (changed) {
            changed = false;
            for (const [b0, b1] of combinations(Object.keys(adj), 2)) {
                if (setEquals(adj[b0], adj[b1])) {
                    labels[b0] = [...labels[b0], ...labels[b1]];
                    delete adj[b1];
                    Object.values(adj).forEach(set => set.delete(b1));
                    changed = true;
                    break;
                }
            }
        }

        const finalNodes = Object.keys(adj).map(node => {
            return {
                id:node,
                label: makeLabel(labels[node]),
                color: makeLabel(labels[node]).includes('[') ? UNMERGED_METANODE_COLOR : MERGED_METANODE_COLOR
            }
        });
        const finalEdges = [];
        Object.keys(adj).forEach(b => {
            adj[b].forEach(n => {
                // Arbitrarily add edges in only one direction (we aren't distinguishing from and to anyway)
                if (b < n) {
                    finalEdges.push({ from: b, to: n });
                }
            });
        });

        return {
            nodes: finalNodes,
            edges: finalEdges
        };
    };

    const makeLabel = (list) => {
        if (list.length === 1) {
            return makeLabelSingle([...list[0]]);
        } else {
            return `[${list.map(v => makeLabelSingle([...v])).join(',\n')}]`;
        }
    };
    const makeLabelSingle = (list) => {
        if (list.length === 1) {
            return list[0];
        } else {
            return `{${list.join(', ')}}`;
        }
    };

    const combinations = (arr, k) => {
        let i, j, temp, output = [], head, tailcombs;

        if (k > arr.length || k <= 0) {
            return [];
        }

        if (k === arr.length) {
            return [arr];
        }

        if (k === 1) {
            for (i = 0; i < arr.length; i++) {
                output.push([arr[i]]);
            }
            return output;
        }

        for (i = 0; i < arr.length - k + 1; i++) {
            head = arr.slice(i, i + 1);
            tailcombs = combinations(arr.slice(i + 1), k - 1);
            for (j = 0; j < tailcombs.length; j++) {
                temp = head.concat(tailcombs[j]);
                output.push(temp);
            }
        }
        return output;
    };

    const setEquals = (a, b) => {
        if (a.size !== b.size) return false;
        for (let item of a) if (!b.has(item)) return false;
        return true;
    };

    const handlePrefixToggle = (prefix) => {
        setSelectedPrefixes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(prefix)) {
                newSet.delete(prefix);
            } else {
                newSet.add(prefix);
            }
            return newSet;
        });
    };

    // Update graph when stuff changes
    useEffect(() => {
        updateGraph(originalData, isMergingEnabled);
    }, [selectedPrefixes, isMergingEnabled, originalData]);

    const hasBaseGame = Array.from(foundPrefixes).some(p => standardPrefixes.has(p));
    const nonStandardPrefixes = Array.from(foundPrefixes).filter(p => !standardPrefixes.has(p));
    const shouldShowCheckboxes = (hasBaseGame && nonStandardPrefixes.length > 0) || nonStandardPrefixes.length > 1;

    const suggestSimilarNeighborsToMerge = () => {
        let suggestions = [];
        let nodeNeighbors = {};

        // Create a map of each node to its neighbors
        graphData.nodes.forEach(node => {
            nodeNeighbors[node.label] = new Set();
        });
        graphData.edges.forEach(edge => {
            const fromLabel = graphData.nodes.find(n => n.id === edge.from).label;
            const toLabel = graphData.nodes.find(n => n.id === edge.to).label;
            nodeNeighbors[fromLabel].add(toLabel);
            nodeNeighbors[toLabel].add(fromLabel);
        });

        // Iterate over each node and its neighbors
        graphData.nodes.forEach(nodeA => {
            nodeNeighbors[nodeA.label].forEach(nodeBLabel => {
                let commonNeighbors = new Set([...nodeNeighbors[nodeA.label]].filter(x => nodeNeighbors[nodeBLabel].has(x)));
                let uniqueNeighborsOfB = new Set([...nodeNeighbors[nodeBLabel]].filter(x => !nodeNeighbors[nodeA.label].has(x)));

                uniqueNeighborsOfB.forEach(nodeCLabel => {
                    if (nodeCLabel !== nodeA.label && nodeCLabel !== nodeBLabel) {
                        suggestions.push({
                            nodeA: nodeA.label,
                            nodeB: nodeBLabel,
                            nodeC: nodeCLabel,
                            commonNeighbors: commonNeighbors.size,
                            uniqueNeighborsOfB: uniqueNeighborsOfB.size - 1 // don't count A
                        });
                    }
                });
            });
        });

        // Sort suggestions based on the number of common neighbors and then on the number of unique neighbors of B
        suggestions.sort((a, b) => {
            return (b.commonNeighbors - a.commonNeighbors) + 42*(a.uniqueNeighborsOfB - b.uniqueNeighborsOfB);
        });
        let topSuggestions = suggestions.slice(0, 10);

        // Format the suggestions for display
        let formattedSuggestions = topSuggestions.map(s =>
            `${s.nodeC} x ${s.nodeA} (which is similar to ${s.nodeB} - Common neighbors: ${s.commonNeighbors}, Unique extras: ${s.uniqueNeighborsOfB})`
        );
        setSuggestedPairs(formattedSuggestions);
    };

    const suggestSimilarNonneighborsToPair = () => {
        let pairs = [];
        let nodeNeighbors = {};
        graphData.nodes.forEach(node => {
            nodeNeighbors[node.id] = new Set();
        });

        // Create a map of each node to its neighbors using current graph data
        graphData.edges.forEach(edge => {
            nodeNeighbors[edge.from].add(edge.to);
            nodeNeighbors[edge.to].add(edge.from);
        });

        // Find all pairs of nodes without an edge between them
        graphData.nodes.forEach(node1 => {
            graphData.nodes.forEach(node2 => {
                if (node1.id < node2.id && !nodeNeighbors[node1.id].has(node2.id)) {
                    let commonNeighbors = new Set([...nodeNeighbors[node1.id]].filter(x => nodeNeighbors[node2.id].has(x)));
                    let nonCommonNeighbors = new Set([...nodeNeighbors[node1.id], ...nodeNeighbors[node2.id]]);
                    pairs.push({
                        pair: [node1.label, node2.label],
                        commonCount: commonNeighbors.size,
                        nonCommonCount: nonCommonNeighbors.size - commonNeighbors.size,
                        score: 42*commonNeighbors.size - (nonCommonNeighbors.size - commonNeighbors.size)
                    });
                }
            });
        });

        // Sort pairs by the score and slice to get top 10
        pairs.sort((a, b) => b.score - a.score);
        let topPairs = pairs.slice(0, 10);

        setSuggestedPairs(topPairs.map(pair => `${pair.pair[0]} x ${pair.pair[1]} (Common: ${pair.commonCount}, Non-Common: ${pair.nonCommonCount})`));
    };

    // TODO: add a way to switch into graph config mode without commenting/uncommenting the div
    return (
        <div style={{ height: '100vh', display: 'flex' }}>
            {/*<div
                ref={configContainerRef}
                style={{
                    minWidth: '250px',
                    height: '100vh', // Sets the height of the container
                    overflow: 'auto' // Enables scrolling for overflow content
            }}>
            </div>*/}
            <div style={{ flexGrow: 1 }}>
                <button onClick={() => handleLoadClipboard(isMergingEnabled)}>Load Clipboard (or use Ctrl/Cmd-V)</button>
                <div>
                    Enable Summary Mode (recommended)
                    <input
                        type="checkbox"
                        checked={isMergingEnabled}
                        onChange={() => setIsMergingEnabled(!isMergingEnabled)}
                    />
                </div>
                <div>Total Pairs: {originalData.edges.length}</div>
                {shouldShowCheckboxes && (
                    <div style={{ display: 'flex', gap: '10px', margin: '10px 0' }}>
                        {hasBaseGame && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                    type="checkbox"
                                    checked={selectedPrefixes.has('Base game')}
                                    onChange={() => handlePrefixToggle('Base game')}
                                />
                                Base game
                            </label>
                        )}
                        {nonStandardPrefixes.sort()
                            .map(prefix => (
                                <label key={prefix} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedPrefixes.has(prefix)}
                                        onChange={() => handlePrefixToggle(prefix)}
                                    />
                                    {prefix}
                                </label>
                            ))}
                    </div>
                )}
                <button onClick={suggestSimilarNonneighborsToPair}>Suggest New Pairs - similar non-neighbor method (Beta)</button>
                <button onClick={suggestSimilarNeighborsToMerge}>Suggest New Pairs - similar neighbor method (Beta)</button>
                <ul>
                    {suggestedPairs.map((pair, index) => (
                        <li key={index}>{pair}</li>
                    ))}
                </ul>
                <Graph key={graphKey} graph={graphData} options={graphOptions} />
            </div>
        </div>
    );
};

export default BunnyGraph;
