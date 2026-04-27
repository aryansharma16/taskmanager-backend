import { registerTenant, login } from '../services/authService.js';

// @desc    Register a new organisation and admin user
// @route   POST /api/auth/register
// @access  Public
export const registerController = async (req, res, next) => {
    try {
        const { orgName, slug, userName, userEmail, userPassword } = req.body;
        
        const { organisation, user } = await registerTenant(orgName, slug, userName, userEmail, userPassword);
        
        // Remove password from response
        const userObj = user.toObject();
        delete userObj.password;

        res.status(201).json({
            success: true,
            data: {
                organisation,
                user: userObj,
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Login user & get token
// @route   POST /api/auth/login
// @access  Public
export const loginController = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Please provide an email and password' });
        }

        const { token, user, orgMembers } = await login(email, password);

        res.status(200).json({
            success: true,
            token,
            data: {
                id: user._id,
                name: user.name,
                email: user.email,
                organisations: orgMembers.map((member) => ({
                    organisationId: member.organisation._id,
                    name: member.organisation.name,
                    slug: member.organisation.slug,
                    role: member.role.name,
                })),
            },
        });
    } catch (error) {
        // Return 401 for login failures
        res.status(401).json({ success: false, error: error.message });
    }
};
