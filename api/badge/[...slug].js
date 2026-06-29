import { GitHubService } from "../../server/services/github.js";

const githubService = new GitHubService();

function calculateScore(repoData, readmeContent) {
    let score = 0;
    
    // Stars: max 40 points
    const stars = repoData.stargazers_count || 0;
    score += Math.min(40, (stars / 500) * 40);
    
    // README: max 25 points
    if (readmeContent && readmeContent.length > 100) score += 25;
    
    // Topics: max 20 points
    if (repoData.topics && repoData.topics.length > 0) score += 20;
    
    // License: max 15 points
    if (repoData.license) score += 15;
    
    return Math.max(10, Math.min(100, Math.round(score)));
}

export default async function handler(req, res) {
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { slug } = req.query;
        if (!slug || slug.length < 2) {
            return res.status(400).json({ error: "Invalid repository format. Use owner/repo" });
        }
        
        const owner = slug[0];
        const repo = slug[1].replace(/\.svg$/, "");

        const repoUrl = `https://github.com/${owner}/${repo}`;
        const repoInfo = await githubService.getRepositoryInfo(repoUrl);
        
        const score = calculateScore(repoInfo.repoData, repoInfo.readmeContent);
        
        let color = "#ef4444"; // red
        if (score >= 80) color = "#22c55e"; // green
        else if (score >= 50) color = "#f59e0b"; // yellow
        
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20">
    <linearGradient id="b" x2="0" y2="100%">
        <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
        <stop offset="1" stop-opacity=".1"/>
    </linearGradient>
    <mask id="a">
        <rect width="120" height="20" rx="3" fill="#fff"/>
    </mask>
    <g mask="url(#a)">
        <rect width="65" height="20" fill="#555"/>
        <rect x="65" width="55" height="20" fill="${color}"/>
        <rect width="120" height="20" fill="url(#b)"/>
    </g>
    <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
        <text x="33.5" y="15" fill="#010101" fill-opacity=".3">RepoLens</text>
        <text x="33.5" y="14">RepoLens</text>
        <text x="91.5" y="15" fill="#010101" fill-opacity=".3">${score}/100</text>
        <text x="91.5" y="14">${score}/100</text>
    </g>
</svg>`;

        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate");
        return res.status(200).send(svg);
    } catch (error) {
        const errorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20">
            <rect width="120" height="20" fill="#ef4444"/>
            <text x="60" y="14" fill="#fff" text-anchor="middle" font-family="sans-serif" font-size="11">Error</text>
        </svg>`;
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "no-cache");
        return res.status(200).send(errorSvg);
    }
}
